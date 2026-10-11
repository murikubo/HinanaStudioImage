#include <algorithm>
#include <android/asset_manager_jni.h>
#include <android/bitmap.h>
#include <android/log.h>
#include <android/native_window_jni.h>
#include <array>
#include <cstring>
#include <jni.h>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include <vulkan/vulkan.h>

namespace {
void check(VkResult result, const char *operation) {
    if (result != VK_SUCCESS)
        throw std::runtime_error(std::string(operation) + ": Vulkan " + std::to_string(result));
}
struct Buffer {
    VkBuffer handle{};
    VkDeviceMemory memory{};
    void *mapped{};
    VkDeviceSize capacity{};
};
struct Image {
    VkImage handle{};
    VkDeviceMemory memory{};
    VkImageView view{};
    uint32_t width{}, height{};
    VkFormat format{};
};
class Renderer {
  public:
    VkInstance instance{};
    VkPhysicalDevice physical{};
    VkDevice device{};
    VkQueue queue{};
    uint32_t family{};
    VkPhysicalDeviceProperties properties{};
    VkPhysicalDeviceMemoryProperties memoryProperties{};
    VkCommandPool pool{};
    VkCommandBuffer command{};
    VkFence fence{};
    bool submitted = false;
    VkDescriptorSetLayout setLayout{};
    VkDescriptorPool descriptors{};
    VkDescriptorSet set{};
    VkPipelineLayout layout{};
    VkSampler sampler{}, nearest{};
    VkShaderModule vertex{}, fragment{};
    std::array<Image, 6> textures{};
    Buffer uniforms{}, staging{}, readback{};
    Image target{};
    VkFramebuffer targetFramebuffer{};
    VkRenderPass offscreenPass{};
    VkPipeline offscreenPipeline{};
    ANativeWindow *window{};
    VkSurfaceKHR surface{};
    VkSwapchainKHR swapchain{};
    VkRenderPass windowPass{};
    VkPipeline windowPipeline{};
    VkSemaphore acquired{};
    std::vector<VkImage> swapImages;
    std::vector<VkImageView> swapViews;
    std::vector<VkFramebuffer> swapFrames;
    std::vector<VkSemaphore> presented;
    VkExtent2D extent{};
    VkSurfaceTransformFlagBitsKHR surfaceTransform = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR;
    bool hdr = false, wantsHDR = false;
    VkFormat windowFormat{};
    size_t uniformBytes{};
    bool descriptorsDirty = true;

    ~Renderer() {
        if (device)
            vkDeviceWaitIdle(device);
        destroySwapchain();
        if (device) {
            if (targetFramebuffer)
                vkDestroyFramebuffer(device, targetFramebuffer, nullptr);
            destroy(target);
            for (auto &t : textures)
                destroy(t);
            destroy(uniforms);
            destroy(staging);
            destroy(readback);
            if (offscreenPipeline)
                vkDestroyPipeline(device, offscreenPipeline, nullptr);
            if (offscreenPass)
                vkDestroyRenderPass(device, offscreenPass, nullptr);
            if (vertex)
                vkDestroyShaderModule(device, vertex, nullptr);
            if (fragment)
                vkDestroyShaderModule(device, fragment, nullptr);
            if (sampler)
                vkDestroySampler(device, sampler, nullptr);
            if (nearest)
                vkDestroySampler(device, nearest, nullptr);
            if (descriptors)
                vkDestroyDescriptorPool(device, descriptors, nullptr);
            if (layout)
                vkDestroyPipelineLayout(device, layout, nullptr);
            if (setLayout)
                vkDestroyDescriptorSetLayout(device, setLayout, nullptr);
            if (acquired)
                vkDestroySemaphore(device, acquired, nullptr);
            if (fence)
                vkDestroyFence(device, fence, nullptr);
            if (pool)
                vkDestroyCommandPool(device, pool, nullptr);
            vkDestroyDevice(device, nullptr);
        }
        if (surface)
            vkDestroySurfaceKHR(instance, surface, nullptr);
        if (window)
            ANativeWindow_release(window);
        if (instance)
            vkDestroyInstance(instance, nullptr);
    }
    bool extension(const std::vector<VkExtensionProperties> &list, const char *name) {
        return std::any_of(list.begin(), list.end(),
                           [&](const auto &e) { return std::strcmp(e.extensionName, name) == 0; });
    }
    void init(AAssetManager *assets, ANativeWindow *nativeWindow, bool requestHDR, size_t bytes) {
        window = nativeWindow;
        wantsHDR = requestHDR;
        uniformBytes = bytes;
        uint32_t count = 0;
        check(vkEnumerateInstanceExtensionProperties(nullptr, &count, nullptr),
              "instance extensions");
        std::vector<VkExtensionProperties> extensions(count);
        check(vkEnumerateInstanceExtensionProperties(nullptr, &count, extensions.data()),
              "instance extensions");
        std::vector<const char *> names;
        if (window) {
            names = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME};
            if (extension(extensions, VK_EXT_SWAPCHAIN_COLOR_SPACE_EXTENSION_NAME))
                names.push_back(VK_EXT_SWAPCHAIN_COLOR_SPACE_EXTENSION_NAME);
        }
        VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        app.pApplicationName = "Hinana Studio Image";
        app.apiVersion = VK_API_VERSION_1_0;
        VkInstanceCreateInfo ci{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        ci.pApplicationInfo = &app;
        ci.enabledExtensionCount = names.size();
        ci.ppEnabledExtensionNames = names.data();
        check(vkCreateInstance(&ci, nullptr, &instance), "create instance");
        if (window) {
            VkAndroidSurfaceCreateInfoKHR s{VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR};
            s.window = window;
            check(vkCreateAndroidSurfaceKHR(instance, &s, nullptr, &surface), "create surface");
        }
        check(vkEnumeratePhysicalDevices(instance, &count, nullptr), "physical devices");
        std::vector<VkPhysicalDevice> devices(count);
        check(vkEnumeratePhysicalDevices(instance, &count, devices.data()), "physical devices");
        for (auto d : devices) {
            uint32_t n = 0;
            vkGetPhysicalDeviceQueueFamilyProperties(d, &n, nullptr);
            std::vector<VkQueueFamilyProperties> families(n);
            vkGetPhysicalDeviceQueueFamilyProperties(d, &n, families.data());
            for (uint32_t i = 0; i < n; i++) {
                VkBool32 present = VK_TRUE;
                if (surface)
                    check(vkGetPhysicalDeviceSurfaceSupportKHR(d, i, surface, &present),
                          "present support");
                if ((families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) && present) {
                    physical = d;
                    family = i;
                    break;
                }
            }
            if (physical)
                break;
        }
        if (!physical)
            throw std::runtime_error("Vulkan graphics queue unavailable");
        vkGetPhysicalDeviceProperties(physical, &properties);
        vkGetPhysicalDeviceMemoryProperties(physical, &memoryProperties);
        for (auto format :
             {VK_FORMAT_R32G32B32A32_SFLOAT, VK_FORMAT_R16G16B16A16_SFLOAT,
              VK_FORMAT_R8G8B8A8_UNORM, VK_FORMAT_R8_UNORM, VK_FORMAT_R32G32_SFLOAT}) {
            VkFormatProperties p;
            vkGetPhysicalDeviceFormatProperties(physical, format, &p);
            auto required = format == VK_FORMAT_R32G32B32A32_SFLOAT
                                ? VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT
                                : VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT;
            if ((p.optimalTilingFeatures & required) != required)
                throw std::runtime_error("Required Vulkan image format unavailable");
            if (format != VK_FORMAT_R32G32_SFLOAT && format != VK_FORMAT_R32G32B32A32_SFLOAT &&
                !(p.optimalTilingFeatures & VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT))
                throw std::runtime_error("Vulkan linear filtering unavailable");
        }
        float priority = 1;
        VkDeviceQueueCreateInfo q{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        q.queueFamilyIndex = family;
        q.queueCount = 1;
        q.pQueuePriorities = &priority;
        VkDeviceCreateInfo dc{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        dc.queueCreateInfoCount = 1;
        dc.pQueueCreateInfos = &q;
        const char *swapName = VK_KHR_SWAPCHAIN_EXTENSION_NAME;
        if (surface) {
            dc.enabledExtensionCount = 1;
            dc.ppEnabledExtensionNames = &swapName;
        }
        check(vkCreateDevice(physical, &dc, nullptr, &device), "create device");
        vkGetDeviceQueue(device, family, 0, &queue);
        VkCommandPoolCreateInfo pc{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        pc.queueFamilyIndex = family;
        pc.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        check(vkCreateCommandPool(device, &pc, nullptr, &pool), "command pool");
        VkCommandBufferAllocateInfo ac{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        ac.commandPool = pool;
        ac.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        ac.commandBufferCount = 1;
        check(vkAllocateCommandBuffers(device, &ac, &command), "command buffer");
        VkFenceCreateInfo fc{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        check(vkCreateFence(device, &fc, nullptr, &fence), "fence");
        VkSemaphoreCreateInfo sc{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
        check(vkCreateSemaphore(device, &sc, nullptr, &acquired), "acquire semaphore");
        std::array<VkDescriptorSetLayoutBinding, 5> bindings{};
        for (uint32_t i = 0; i < 5; i++) {
            bindings[i].binding = i;
            bindings[i].descriptorType =
                i ? VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER : VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
            bindings[i].descriptorCount = 1;
            bindings[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
        }
        VkDescriptorSetLayoutCreateInfo lc{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        lc.bindingCount = bindings.size();
        lc.pBindings = bindings.data();
        check(vkCreateDescriptorSetLayout(device, &lc, nullptr, &setLayout), "descriptor layout");
        VkPipelineLayoutCreateInfo plc{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        VkPushConstantRange transformRange{VK_SHADER_STAGE_VERTEX_BIT, 0, 16};
        plc.pushConstantRangeCount = 1;
        plc.pPushConstantRanges = &transformRange;
        plc.setLayoutCount = 1;
        plc.pSetLayouts = &setLayout;
        check(vkCreatePipelineLayout(device, &plc, nullptr, &layout), "pipeline layout");
        VkDescriptorPoolSize sizes[] = {{VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1},
                                        {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 4}};
        VkDescriptorPoolCreateInfo dpc{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        dpc.maxSets = 1;
        dpc.poolSizeCount = 2;
        dpc.pPoolSizes = sizes;
        check(vkCreateDescriptorPool(device, &dpc, nullptr, &descriptors), "descriptor pool");
        VkDescriptorSetAllocateInfo dac{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        dac.descriptorPool = descriptors;
        dac.descriptorSetCount = 1;
        dac.pSetLayouts = &setLayout;
        check(vkAllocateDescriptorSets(device, &dac, &set), "descriptor set");
        allocate(uniforms, bytes, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
        VkSamplerCreateInfo samplerInfo{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
        samplerInfo.magFilter = VK_FILTER_LINEAR;
        samplerInfo.minFilter = VK_FILTER_LINEAR;
        samplerInfo.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
        samplerInfo.addressModeU = samplerInfo.addressModeV = samplerInfo.addressModeW =
            VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        check(vkCreateSampler(device, &samplerInfo, nullptr, &sampler), "sampler");
        samplerInfo.magFilter = samplerInfo.minFilter = VK_FILTER_NEAREST;
        check(vkCreateSampler(device, &samplerInfo, nullptr, &nearest), "nearest sampler");
        vertex = shader(assets, "vulkan/photo.vert.spv");
        fragment = shader(assets, "vulkan/photo.frag.spv");
        offscreenPass = renderPass(VK_FORMAT_R32G32B32A32_SFLOAT, false);
        offscreenPipeline = pipeline(offscreenPass);
        // All descriptors must have valid images even when their shader branch is disabled.
        const uint32_t white = 0xffffffff;
        for (int i = 0; i < 6; i++)
            upload(i, 1, 1, VK_FORMAT_R8G8B8A8_UNORM, 4, &white, 4);
        if (window)
            resize(ANativeWindow_getWidth(window), ANativeWindow_getHeight(window));
        __android_log_print(ANDROID_LOG_INFO, "HinanaVulkan", "Initialized %s",
                            properties.deviceName);
    }
    uint32_t memoryType(uint32_t bits, VkMemoryPropertyFlags flags) {
        for (uint32_t i = 0; i < memoryProperties.memoryTypeCount; i++)
            if ((bits & (1u << i)) &&
                (memoryProperties.memoryTypes[i].propertyFlags & flags) == flags)
                return i;
        throw std::runtime_error("Vulkan memory type unavailable");
    }
    void destroy(Buffer &b) {
        if (b.mapped)
            vkUnmapMemory(device, b.memory);
        if (b.handle)
            vkDestroyBuffer(device, b.handle, nullptr);
        if (b.memory)
            vkFreeMemory(device, b.memory, nullptr);
        b = {};
    }
    void destroy(Image &i) {
        if (i.view)
            vkDestroyImageView(device, i.view, nullptr);
        if (i.handle)
            vkDestroyImage(device, i.handle, nullptr);
        if (i.memory)
            vkFreeMemory(device, i.memory, nullptr);
        i = {};
    }
    void allocate(Buffer &b, VkDeviceSize size, VkBufferUsageFlags usage) {
        if (b.capacity >= size)
            return;
        destroy(b);
        VkBufferCreateInfo ci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        ci.size = size;
        ci.usage = usage;
        ci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        check(vkCreateBuffer(device, &ci, nullptr, &b.handle), "buffer");
        VkMemoryRequirements req;
        vkGetBufferMemoryRequirements(device, b.handle, &req);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize = req.size;
        ai.memoryTypeIndex =
            memoryType(req.memoryTypeBits,
                       VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        check(vkAllocateMemory(device, &ai, nullptr, &b.memory), "buffer memory");
        check(vkBindBufferMemory(device, b.handle, b.memory, 0), "bind buffer");
        check(vkMapMemory(device, b.memory, 0, VK_WHOLE_SIZE, 0, &b.mapped), "map buffer");
        b.capacity = size;
    }
    void image(Image &out, uint32_t w, uint32_t h, VkFormat format, VkImageUsageFlags usage) {
        if (w > properties.limits.maxImageDimension2D ||
            h > properties.limits.maxImageDimension2D || !w || !h)
            throw std::runtime_error("Vulkan image size exceeds GPU limit");
        VkImageCreateInfo ci{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        ci.imageType = VK_IMAGE_TYPE_2D;
        ci.format = format;
        ci.extent = {w, h, 1};
        ci.mipLevels = 1;
        ci.arrayLayers = 1;
        ci.samples = VK_SAMPLE_COUNT_1_BIT;
        ci.tiling = VK_IMAGE_TILING_OPTIMAL;
        ci.usage = usage;
        ci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        check(vkCreateImage(device, &ci, nullptr, &out.handle), "image");
        VkMemoryRequirements req;
        vkGetImageMemoryRequirements(device, out.handle, &req);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize = req.size;
        ai.memoryTypeIndex = memoryType(req.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        check(vkAllocateMemory(device, &ai, nullptr, &out.memory), "image memory");
        check(vkBindImageMemory(device, out.handle, out.memory, 0), "bind image");
        out.view = view(out.handle, format, format == VK_FORMAT_R8_UNORM);
        out.width = w;
        out.height = h;
        out.format = format;
    }
    VkImageView view(VkImage image, VkFormat format, bool mono = false) {
        VkImageViewCreateInfo ci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        ci.image = image;
        ci.viewType = VK_IMAGE_VIEW_TYPE_2D;
        ci.format = format;
        if (mono)
            ci.components = {VK_COMPONENT_SWIZZLE_R, VK_COMPONENT_SWIZZLE_R, VK_COMPONENT_SWIZZLE_R,
                             VK_COMPONENT_SWIZZLE_ONE};
        ci.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        VkImageView result{};
        check(vkCreateImageView(device, &ci, nullptr, &result), "image view");
        return result;
    }
    void wait() {
        if (submitted) {
            check(vkWaitForFences(device, 1, &fence, VK_TRUE, UINT64_MAX), "GPU completion");
            submitted = false;
        }
    }
    void begin() {
        wait();
        check(vkResetCommandBuffer(command, 0), "reset commands");
        VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        check(vkBeginCommandBuffer(command, &bi), "begin commands");
    }
    void submit(VkSemaphore waitFor = VK_NULL_HANDLE, VkSemaphore signal = VK_NULL_HANDLE) {
        check(vkEndCommandBuffer(command), "end commands");
        check(vkResetFences(device, 1, &fence), "reset fence");
        VkPipelineStageFlags stage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        si.commandBufferCount = 1;
        si.pCommandBuffers = &command;
        if (waitFor) {
            si.waitSemaphoreCount = 1;
            si.pWaitSemaphores = &waitFor;
            si.pWaitDstStageMask = &stage;
        }
        if (signal) {
            si.signalSemaphoreCount = 1;
            si.pSignalSemaphores = &signal;
        }
        check(vkQueueSubmit(queue, 1, &si, fence), "submit");
        submitted = true;
    }
    void barrier(VkImage image, VkImageLayout oldLayout, VkImageLayout newLayout, VkAccessFlags src,
                 VkAccessFlags dst, VkPipelineStageFlags from, VkPipelineStageFlags to) {
        VkImageMemoryBarrier b{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        b.oldLayout = oldLayout;
        b.newLayout = newLayout;
        b.srcAccessMask = src;
        b.dstAccessMask = dst;
        b.srcQueueFamilyIndex = b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        b.image = image;
        b.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        vkCmdPipelineBarrier(command, from, to, 0, 0, nullptr, 0, nullptr, 1, &b);
    }
    void upload(int index, uint32_t w, uint32_t h, VkFormat format, uint32_t stride,
                const void *pixels, size_t length) {
        if (index < 0 || index >= 6)
            throw std::runtime_error("Invalid image slot");
        const uint32_t bytes =
            format == VK_FORMAT_R8_UNORM                                                   ? 1
            : format == VK_FORMAT_R16G16B16A16_SFLOAT || format == VK_FORMAT_R32G32_SFLOAT ? 8
                                                                                           : 4;
        if (stride < w * bytes || length < size_t(stride) * h)
            throw std::runtime_error("Invalid image stride");
        begin();
        auto &t = textures[index];
        bool reused = t.handle && t.width == w && t.height == h && t.format == format;
        if (!reused) {
            destroy(t);
            image(t, w, h, format, VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT);
            descriptorsDirty = true;
        }
        allocate(staging, size_t(w) * h * bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
        for (uint32_t y = 0; y < h; y++)
            std::memcpy(static_cast<char *>(staging.mapped) + size_t(y) * w * bytes,
                        static_cast<const char *>(pixels) + size_t(y) * stride, w * bytes);
        barrier(t.handle,
                reused ? VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL : VK_IMAGE_LAYOUT_UNDEFINED,
                VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, reused ? VK_ACCESS_SHADER_READ_BIT : 0,
                VK_ACCESS_TRANSFER_WRITE_BIT,
                reused ? VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT : VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                VK_PIPELINE_STAGE_TRANSFER_BIT);
        VkBufferImageCopy copy{};
        copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
        copy.imageExtent = {w, h, 1};
        vkCmdCopyBufferToImage(command, staging.handle, t.handle,
                               VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &copy);
        barrier(t.handle, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_ACCESS_TRANSFER_WRITE_BIT,
                VK_ACCESS_SHADER_READ_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
        submit();
        wait();
    }
    VkShaderModule shader(AAssetManager *assets, const char *name) {
        AAsset *a = AAssetManager_open(assets, name, AASSET_MODE_BUFFER);
        if (!a)
            throw std::runtime_error("Vulkan shader asset missing");
        size_t length = AAsset_getLength(a);
        std::vector<uint32_t> bytes((length + 3) / 4);
        int read = AAsset_read(a, bytes.data(), length);
        AAsset_close(a);
        if (read != int(length))
            throw std::runtime_error("Vulkan shader asset incomplete");
        VkShaderModuleCreateInfo ci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        ci.codeSize = length;
        ci.pCode = bytes.data();
        VkShaderModule result{};
        check(vkCreateShaderModule(device, &ci, nullptr, &result), "shader module");
        return result;
    }
    VkRenderPass renderPass(VkFormat format, bool present) {
        VkAttachmentDescription a{};
        a.format = format;
        a.samples = VK_SAMPLE_COUNT_1_BIT;
        a.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        a.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        a.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        a.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        a.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        a.finalLayout =
            present ? VK_IMAGE_LAYOUT_PRESENT_SRC_KHR : VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkSubpassDescription s{};
        s.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        s.colorAttachmentCount = 1;
        s.pColorAttachments = &ref;
        VkSubpassDependency dependencies[2]{};
        dependencies[0].srcSubpass = VK_SUBPASS_EXTERNAL;
        dependencies[0].dstSubpass = 0;
        dependencies[0].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dependencies[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dependencies[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        dependencies[1].srcSubpass = 0;
        dependencies[1].dstSubpass = VK_SUBPASS_EXTERNAL;
        dependencies[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dependencies[1].dstStageMask =
            present ? VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT : VK_PIPELINE_STAGE_TRANSFER_BIT;
        dependencies[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        dependencies[1].dstAccessMask = present ? 0 : VK_ACCESS_TRANSFER_READ_BIT;
        VkRenderPassCreateInfo ci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
        ci.attachmentCount = 1;
        ci.pAttachments = &a;
        ci.subpassCount = 1;
        ci.pSubpasses = &s;
        ci.dependencyCount = 2;
        ci.pDependencies = dependencies;
        VkRenderPass result{};
        check(vkCreateRenderPass(device, &ci, nullptr, &result), "render pass");
        return result;
    }
    VkPipeline pipeline(VkRenderPass pass) {
        VkPipelineShaderStageCreateInfo stages[2]{};
        for (auto &s : stages) {
            s.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
            s.pName = "main";
        }
        stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
        stages[0].module = vertex;
        stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
        stages[1].module = fragment;
        VkPipelineVertexInputStateCreateInfo vi{
            VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
        VkPipelineInputAssemblyStateCreateInfo ia{
            VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
        ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP;
        VkPipelineViewportStateCreateInfo vp{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
        vp.viewportCount = vp.scissorCount = 1;
        VkPipelineRasterizationStateCreateInfo rs{
            VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
        rs.polygonMode = VK_POLYGON_MODE_FILL;
        rs.cullMode = VK_CULL_MODE_NONE;
        rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
        rs.lineWidth = 1;
        VkPipelineMultisampleStateCreateInfo ms{
            VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
        ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
        VkPipelineColorBlendAttachmentState ba{};
        ba.colorWriteMask = 15;
        VkPipelineColorBlendStateCreateInfo blend{
            VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
        blend.attachmentCount = 1;
        blend.pAttachments = &ba;
        VkDynamicState dynamic[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
        VkPipelineDynamicStateCreateInfo dyn{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
        dyn.dynamicStateCount = 2;
        dyn.pDynamicStates = dynamic;
        VkGraphicsPipelineCreateInfo ci{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
        ci.stageCount = 2;
        ci.pStages = stages;
        ci.pVertexInputState = &vi;
        ci.pInputAssemblyState = &ia;
        ci.pViewportState = &vp;
        ci.pRasterizationState = &rs;
        ci.pMultisampleState = &ms;
        ci.pColorBlendState = &blend;
        ci.pDynamicState = &dyn;
        ci.layout = layout;
        ci.renderPass = pass;
        VkPipeline result{};
        check(vkCreateGraphicsPipelines(device, VK_NULL_HANDLE, 1, &ci, nullptr, &result),
              "graphics pipeline");
        return result;
    }
    VkFramebuffer framebuffer(VkRenderPass pass, VkImageView image, uint32_t w, uint32_t h) {
        VkFramebufferCreateInfo ci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
        ci.renderPass = pass;
        ci.attachmentCount = 1;
        ci.pAttachments = &image;
        ci.width = w;
        ci.height = h;
        ci.layers = 1;
        VkFramebuffer result{};
        check(vkCreateFramebuffer(device, &ci, nullptr, &result), "framebuffer");
        return result;
    }
    void destroySwapchain() {
        if (!device)
            return;
        for (auto f : swapFrames)
            vkDestroyFramebuffer(device, f, nullptr);
        swapFrames.clear();
        for (auto v : swapViews)
            vkDestroyImageView(device, v, nullptr);
        swapViews.clear();
        for (auto s : presented)
            vkDestroySemaphore(device, s, nullptr);
        presented.clear();
        swapImages.clear();
        if (windowPipeline)
            vkDestroyPipeline(device, windowPipeline, nullptr);
        windowPipeline = {};
        if (windowPass)
            vkDestroyRenderPass(device, windowPass, nullptr);
        windowPass = {};
        if (swapchain)
            vkDestroySwapchainKHR(device, swapchain, nullptr);
        swapchain = {};
    }
    void resize(uint32_t width, uint32_t height) {
        if (!surface || !width || !height)
            return;
        wait();
        check(vkQueueWaitIdle(queue), "resize completion");
        destroySwapchain();
        VkSurfaceCapabilitiesKHR caps{};
        check(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical, surface, &caps),
              "surface capabilities");
        uint32_t count = 0;
        check(vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface, &count, nullptr),
              "surface formats");
        std::vector<VkSurfaceFormatKHR> formats(count);
        check(vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface, &count, formats.data()),
              "surface formats");
        if (formats.empty())
            throw std::runtime_error("Vulkan surface format unavailable");
        VkSurfaceFormatKHR chosen = formats.front();
        bool found = false;
        for (auto f : formats)
            if ((f.format == VK_FORMAT_R8G8B8A8_UNORM || f.format == VK_FORMAT_B8G8R8A8_UNORM) &&
                f.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) {
                chosen = f;
                found = true;
                break;
            }
        hdr = false;
        if (wantsHDR)
            for (auto f : formats)
                if ((f.format == VK_FORMAT_A2B10G10R10_UNORM_PACK32 ||
                     f.format == VK_FORMAT_A2R10G10B10_UNORM_PACK32) &&
                    f.colorSpace == VK_COLOR_SPACE_HDR10_ST2084_EXT) {
                    chosen = f;
                    hdr = true;
                    found = true;
                    break;
                }
        if (!found)
            throw std::runtime_error("Vulkan SDR/HDR surface unavailable");
        extent =
            caps.currentExtent.width != UINT32_MAX
                ? caps.currentExtent
                : VkExtent2D{
                      std::clamp(width, caps.minImageExtent.width, caps.maxImageExtent.width),
                      std::clamp(height, caps.minImageExtent.height, caps.maxImageExtent.height)};
        surfaceTransform = caps.currentTransform;
        // currentExtent describes the logical SurfaceView. With pre-rotation, the buffer
        // must use the panel's native axes; the vertex shader applies the same transform.
        if (quarterTurn(surfaceTransform))
            std::swap(extent.width, extent.height);
        uint32_t images = caps.minImageCount + 1;
        if (caps.maxImageCount)
            images = std::min(images, caps.maxImageCount);
        VkSwapchainCreateInfoKHR ci{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
        ci.surface = surface;
        ci.minImageCount = images;
        ci.imageFormat = chosen.format;
        ci.imageColorSpace = chosen.colorSpace;
        ci.imageExtent = extent;
        ci.imageArrayLayers = 1;
        ci.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
        ci.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
        ci.preTransform = surfaceTransform;
        __android_log_print(ANDROID_LOG_INFO, "HinanaVulkan",
                            "Geometry logical %ux%u buffer %ux%u currentTransform=%u supported=%u",
                            width, height, extent.width, extent.height, caps.currentTransform,
                            caps.supportedTransforms);
        ci.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
        if (!(caps.supportedCompositeAlpha & ci.compositeAlpha))
            ci.compositeAlpha = static_cast<VkCompositeAlphaFlagBitsKHR>(
                caps.supportedCompositeAlpha & (~caps.supportedCompositeAlpha + 1));
        ci.presentMode = VK_PRESENT_MODE_FIFO_KHR;
        ci.clipped = VK_TRUE;
        check(vkCreateSwapchainKHR(device, &ci, nullptr, &swapchain), "swapchain");
        check(vkGetSwapchainImagesKHR(device, swapchain, &count, nullptr), "swapchain images");
        swapImages.resize(count);
        check(vkGetSwapchainImagesKHR(device, swapchain, &count, swapImages.data()),
              "swapchain images");
        windowFormat = chosen.format;
        windowPass = renderPass(chosen.format, true);
        windowPipeline = pipeline(windowPass);
        VkSemaphoreCreateInfo sc{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
        for (auto image : swapImages) {
            auto v = view(image, chosen.format);
            swapViews.push_back(v);
            swapFrames.push_back(framebuffer(windowPass, v, extent.width, extent.height));
            VkSemaphore s{};
            check(vkCreateSemaphore(device, &sc, nullptr, &s), "present semaphore");
            presented.push_back(s);
        }
        __android_log_print(ANDROID_LOG_INFO, "HinanaVulkan", "Surface %ux%u %s", extent.width,
                            extent.height, hdr ? "10-bit BT2020 PQ" : "SDR");
    }
    void updateDescriptors() {
        if (!descriptorsDirty)
            return;
        VkDescriptorBufferInfo ub{uniforms.handle, 0, uniformBytes};
        std::array<VkDescriptorImageInfo, 4> images{};
        std::array<VkWriteDescriptorSet, 5> writes{};
        int slots[] = {0, 1, 2, 5};
        for (int i = 0; i < 5; i++) {
            auto &w = writes[i];
            w.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w.dstSet = set;
            w.dstBinding = i;
            w.descriptorCount = 1;
            w.descriptorType =
                i ? VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER : VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
            if (i) {
                images[i - 1] = {i == 4 ? nearest : sampler, textures[slots[i - 1]].view,
                                 VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL};
                w.pImageInfo = &images[i - 1];
            } else
                w.pBufferInfo = &ub;
        }
        vkUpdateDescriptorSets(device, writes.size(), writes.data(), 0, nullptr);
        descriptorsDirty = false;
    }
    static bool quarterTurn(uint32_t transform) {
        return transform == VK_SURFACE_TRANSFORM_ROTATE_90_BIT_KHR ||
               transform == VK_SURFACE_TRANSFORM_ROTATE_270_BIT_KHR ||
               transform == VK_SURFACE_TRANSFORM_HORIZONTAL_MIRROR_ROTATE_90_BIT_KHR ||
               transform == VK_SURFACE_TRANSFORM_HORIZONTAL_MIRROR_ROTATE_270_BIT_KHR;
    }
    static std::array<float, 4> transformRows(uint32_t transform) {
        // Clockwise transforms in Vulkan's downward-positive screen coordinates.
        switch (transform) {
        case VK_SURFACE_TRANSFORM_ROTATE_90_BIT_KHR:
            return {0, -1, 1, 0};
        case VK_SURFACE_TRANSFORM_ROTATE_180_BIT_KHR:
            return {-1, 0, 0, -1};
        case VK_SURFACE_TRANSFORM_ROTATE_270_BIT_KHR:
            return {0, 1, -1, 0};
        case VK_SURFACE_TRANSFORM_HORIZONTAL_MIRROR_BIT_KHR:
            return {-1, 0, 0, 1};
        case VK_SURFACE_TRANSFORM_HORIZONTAL_MIRROR_ROTATE_90_BIT_KHR:
            return {0, -1, -1, 0};
        case VK_SURFACE_TRANSFORM_HORIZONTAL_MIRROR_ROTATE_180_BIT_KHR:
            return {1, 0, 0, -1};
        case VK_SURFACE_TRANSFORM_HORIZONTAL_MIRROR_ROTATE_270_BIT_KHR:
            return {0, 1, 1, 0};
        default:
            return {1, 0, 0, 1};
        }
    }
    void draw(uint32_t w, uint32_t h, const void *values, bool onscreen,
              uint32_t offscreenTransform = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR) {
        const uint32_t logicalWidth = w, logicalHeight = h;
        begin();
        std::memcpy(uniforms.mapped, values, uniformBytes);
        updateDescriptors();
        VkRenderPass pass = offscreenPass;
        VkPipeline pipe = offscreenPipeline;
        VkFramebuffer frame{};
        uint32_t index = 0;
        if (onscreen) {
            if (!swapchain)
                resize(logicalWidth, logicalHeight);
            VkResult result = vkAcquireNextImageKHR(device, swapchain, UINT64_MAX, acquired,
                                                    VK_NULL_HANDLE, &index);
            if (result == VK_ERROR_OUT_OF_DATE_KHR) {
                resize(logicalWidth, logicalHeight);
                result = vkAcquireNextImageKHR(device, swapchain, UINT64_MAX, acquired,
                                               VK_NULL_HANDLE, &index);
            }
            if (result != VK_SUBOPTIMAL_KHR)
                check(result, "acquire image");
            w = extent.width;
            h = extent.height;
            pass = windowPass;
            pipe = windowPipeline;
            frame = swapFrames[index];
        } else {
            if (target.width != w || target.height != h) {
                if (targetFramebuffer)
                    vkDestroyFramebuffer(device, targetFramebuffer, nullptr);
                targetFramebuffer = {};
                destroy(target);
                image(target, w, h, VK_FORMAT_R32G32B32A32_SFLOAT,
                      VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT);
                targetFramebuffer = framebuffer(pass, target.view, w, h);
            }
            frame = targetFramebuffer;
        }
        VkRenderPassBeginInfo bi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
        bi.renderPass = pass;
        bi.framebuffer = frame;
        bi.renderArea = {{0, 0}, {w, h}};
        vkCmdBeginRenderPass(command, &bi, VK_SUBPASS_CONTENTS_INLINE);
        VkViewport vp{0, 0, float(w), float(h), 0, 1};
        VkRect2D rect{{0, 0}, {w, h}};
        vkCmdSetViewport(command, 0, 1, &vp);
        vkCmdSetScissor(command, 0, 1, &rect);
        vkCmdBindPipeline(command, VK_PIPELINE_BIND_POINT_GRAPHICS, pipe);
        auto transform = transformRows(onscreen ? surfaceTransform : offscreenTransform);
        vkCmdPushConstants(command, layout, VK_SHADER_STAGE_VERTEX_BIT, 0, 16, transform.data());
        vkCmdBindDescriptorSets(command, VK_PIPELINE_BIND_POINT_GRAPHICS, layout, 0, 1, &set, 0,
                                nullptr);
        vkCmdDraw(command, 4, 1, 0, 0);
        vkCmdEndRenderPass(command);
        if (!onscreen) {
            allocate(readback, size_t(w) * h * 16, VK_BUFFER_USAGE_TRANSFER_DST_BIT);
            VkBufferImageCopy copy{};
            copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
            copy.imageExtent = {w, h, 1};
            vkCmdCopyImageToBuffer(command, target.handle, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                                   readback.handle, 1, &copy);
            VkBufferMemoryBarrier b{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
            b.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            b.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
            b.srcQueueFamilyIndex = b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            b.buffer = readback.handle;
            b.size = VK_WHOLE_SIZE;
            vkCmdPipelineBarrier(command, VK_PIPELINE_STAGE_TRANSFER_BIT,
                                 VK_PIPELINE_STAGE_HOST_BIT, 0, 0, nullptr, 1, &b, 0, nullptr);
        }
        submit(onscreen ? acquired : VK_NULL_HANDLE, onscreen ? presented[index] : VK_NULL_HANDLE);
        if (onscreen) {
            VkPresentInfoKHR pi{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
            pi.waitSemaphoreCount = 1;
            pi.pWaitSemaphores = &presented[index];
            pi.swapchainCount = 1;
            pi.pSwapchains = &swapchain;
            pi.pImageIndices = &index;
            auto result = vkQueuePresentKHR(queue, &pi);
            if (result == VK_ERROR_OUT_OF_DATE_KHR || result == VK_SUBOPTIMAL_KHR)
                resize(logicalWidth, logicalHeight);
            else
                check(result, "present");
        }
    }
    void pixels(void *destination, size_t capacity) {
        wait();
        size_t row = size_t(target.width) * 16;
        if (capacity < row * target.height)
            throw std::runtime_error("Readback buffer too small");
        // Kotlin export historically consumes GLES bottom-to-top rows. Preserve that contract.
        for (uint32_t y = 0; y < target.height; y++)
            std::memcpy(static_cast<char *>(destination) + y * row,
                        static_cast<char *>(readback.mapped) + (target.height - 1 - y) * row, row);
    }
    void swapSources() {
        wait();
        std::swap(textures[0], textures[3]);
        std::swap(textures[1], textures[4]);
        descriptorsDirty = true;
    }
};
Renderer *renderer(jlong handle) {
    if (!handle)
        throw std::runtime_error("Vulkan renderer closed");
    return reinterpret_cast<Renderer *>(handle);
}
void exception(JNIEnv *env, const std::exception &e) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), e.what());
}
} // namespace
extern "C" JNIEXPORT jlong JNICALL Java_studio_hinana_image_nativeeditor_NativeVulkan_create(
    JNIEnv *env, jobject, jobject assets, jobject surface, jboolean hdr, jint bytes) {
    try {
        auto r = std::make_unique<Renderer>();
        r->init(AAssetManager_fromJava(env, assets),
                surface ? ANativeWindow_fromSurface(env, surface) : nullptr, hdr, bytes);
        return reinterpret_cast<jlong>(r.release());
    } catch (const std::exception &e) {
        exception(env, e);
        return 0;
    }
}
extern "C" JNIEXPORT void JNICALL
Java_studio_hinana_image_nativeeditor_NativeVulkan_close(JNIEnv *, jobject, jlong h) {
    delete reinterpret_cast<Renderer *>(h);
}
// Copy actual bitmap rows directly into reusable Vulkan staging, without a Java image buffer.
extern "C" JNIEXPORT void JNICALL
Java_studio_hinana_image_nativeeditor_NativeVulkan_uploadBitmapNative(JNIEnv *env, jobject, jlong h,
                                                                      jint index, jobject bitmap) {
    AndroidBitmapInfo info{};
    void *data = nullptr;
    try {
        if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS)
            throw std::runtime_error("Cannot inspect bitmap");
        VkFormat format;
        switch (info.format) {
        case ANDROID_BITMAP_FORMAT_A_8:
            format = VK_FORMAT_R8_UNORM;
            break;
        case ANDROID_BITMAP_FORMAT_RGBA_8888:
            format = VK_FORMAT_R8G8B8A8_UNORM;
            break;
        case ANDROID_BITMAP_FORMAT_RGBA_F16:
            format = VK_FORMAT_R16G16B16A16_SFLOAT;
            break;
        default:
            throw std::runtime_error("Unsupported bitmap format");
        }
        if (AndroidBitmap_lockPixels(env, bitmap, &data) != ANDROID_BITMAP_RESULT_SUCCESS)
            throw std::runtime_error("Cannot lock bitmap pixels");
        renderer(h)->upload(index, info.width, info.height, format, info.stride, data,
                            size_t(info.stride) * info.height);
        AndroidBitmap_unlockPixels(env, bitmap);
    } catch (const std::exception &e) {
        if (data)
            AndroidBitmap_unlockPixels(env, bitmap);
        exception(env, e);
    }
}
extern "C" JNIEXPORT void JNICALL Java_studio_hinana_image_nativeeditor_NativeVulkan_upload(
    JNIEnv *env, jobject, jlong h, jint index, jint w, jint height, jint format, jint stride,
    jobject data) {
    try {
        auto p = env->GetDirectBufferAddress(data);
        auto size = env->GetDirectBufferCapacity(data);
        if (!p || size < 0)
            throw std::runtime_error("Direct image buffer required");
        renderer(h)->upload(index, w, height, static_cast<VkFormat>(format), stride, p, size);
    } catch (const std::exception &e) {
        exception(env, e);
    }
}
extern "C" JNIEXPORT void JNICALL Java_studio_hinana_image_nativeeditor_NativeVulkan_resize(
    JNIEnv *env, jobject, jlong h, jint w, jint height) {
    try {
        renderer(h)->resize(w, height);
    } catch (const std::exception &e) {
        exception(env, e);
    }
}
extern "C" JNIEXPORT jboolean JNICALL
Java_studio_hinana_image_nativeeditor_NativeVulkan_hdr(JNIEnv *env, jobject, jlong h) {
    try {
        return renderer(h)->hdr;
    } catch (const std::exception &e) {
        exception(env, e);
        return false;
    }
}
extern "C" JNIEXPORT jint JNICALL
Java_studio_hinana_image_nativeeditor_NativeVulkan_limit(JNIEnv *env, jobject, jlong h) {
    try {
        return renderer(h)->properties.limits.maxImageDimension2D;
    } catch (const std::exception &e) {
        exception(env, e);
        return 0;
    }
}
extern "C" JNIEXPORT void JNICALL Java_studio_hinana_image_nativeeditor_NativeVulkan_draw(
    JNIEnv *env, jobject, jlong h, jint w, jint height, jobject values, jboolean screen,
    jint transform) {
    try {
        auto p = env->GetDirectBufferAddress(values);
        if (!p || env->GetDirectBufferCapacity(values) < jlong(renderer(h)->uniformBytes))
            throw std::runtime_error("Invalid uniforms buffer");
        renderer(h)->draw(w, height, p, screen, transform);
    } catch (const std::exception &e) {
        exception(env, e);
    }
}
extern "C" JNIEXPORT void JNICALL Java_studio_hinana_image_nativeeditor_NativeVulkan_pixels(
    JNIEnv *env, jobject, jlong h, jobject data) {
    try {
        auto p = env->GetDirectBufferAddress(data);
        auto n = env->GetDirectBufferCapacity(data);
        if (!p || n < 0)
            throw std::runtime_error("Invalid readback buffer");
        renderer(h)->pixels(p, n);
    } catch (const std::exception &e) {
        exception(env, e);
    }
}
extern "C" JNIEXPORT void JNICALL
Java_studio_hinana_image_nativeeditor_NativeVulkan_swapSources(JNIEnv *env, jobject, jlong h) {
    try {
        renderer(h)->swapSources();
    } catch (const std::exception &e) {
        exception(env, e);
    }
}
