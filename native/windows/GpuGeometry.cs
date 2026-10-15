// Windows hardware DirectCompute host. No WebGL, WARP, NuGet, or GPU vendor runtime.
// COM slots follow the Windows SDK ID3D11Device / ID3D11DeviceContext ABI.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

sealed class GpuGeometry : IDisposable
{
    [DllImport("d3d11.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int D3D11CreateDevice(IntPtr adapter, uint driver, IntPtr software, uint flags,
        uint[] levels, uint count, uint sdk, out IntPtr device, out uint level, out IntPtr context);
    [DllImport("d3dcompiler_47.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int D3DCompile(byte[] code, UIntPtr length, string name, IntPtr defines,
        IntPtr include, string entry, string target, uint flags, uint flags2,
        out IntPtr shader, out IntPtr errors);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int CreateBuffer(IntPtr self, ref BufferDesc desc, IntPtr initial, out IntPtr buffer);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int CreateView(IntPtr self, IntPtr resource, IntPtr desc, out IntPtr view);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int CreateShader(IntPtr self, IntPtr code, UIntPtr size, IntPtr linkage, out IntPtr shader);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate IntPtr BlobPointer(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate UIntPtr BlobSize(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void SetResources(IntPtr self, uint start, uint count, IntPtr[] resources);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void SetUAV(IntPtr self, uint start, uint count, IntPtr[] views, IntPtr counts);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void SetShader(IntPtr self, IntPtr shader, IntPtr instances, uint count);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void Dispatch(IntPtr self, uint x, uint y, uint z);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void CopyResource(IntPtr self, IntPtr destination, IntPtr source);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void Update(IntPtr self, IntPtr resource, uint index, IntPtr box, IntPtr data, uint pitch, uint depth);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int Map(IntPtr self, IntPtr resource, uint index, uint mode, uint flags, out Mapped data);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void Unmap(IntPtr self, IntPtr resource, uint index);
    [StructLayout(LayoutKind.Sequential)]
    struct BufferDesc { public uint Size, Usage, Bind, CPU, Misc, Stride; }
    [StructLayout(LayoutKind.Sequential)]
    struct Initial { public IntPtr Data; public uint Pitch, Slice; }
    [StructLayout(LayoutKind.Sequential)]
    struct Mapped { public IntPtr Data; public uint Pitch, Depth; }
    static T Method<T>(IntPtr obj, int slot) where T : class
    {
        return (T)(object)Marshal.GetDelegateForFunctionPointer(
            Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj), slot * IntPtr.Size), typeof(T));
    }
    static void Check(int hr) { Marshal.ThrowExceptionForHR(hr); }
    static void Release(ref IntPtr value) { if (value != IntPtr.Zero) Marshal.Release(value); value = IntPtr.Zero; }
    IntPtr device, context, shader, source, sourceView, field, fieldView, output, outputView, staging, constants;
    int sourceBytes, outputBytes;
    const int MapBytes = 129 * 129 * 2 * 4;
    const string Hlsl = @"
StructuredBuffer<float4> picture : register(t0);
StructuredBuffer<float2> field : register(t1);
RWStructuredBuffer<float4> result : register(u0);
cbuffer Geometry : register(b0) {
 uint sw; uint sh; uint ow; uint oh;
 float cw; float ch; float cosine; float sine;
 float flip; float offsetX; float offsetY; float pad;
};
float2 displacement(float2 p) {
 float2 g = saturate(p) * 128.0;
 uint2 i = (uint2)min(floor(g), 127.0);
 float2 t = g - i;
 uint k = i.y * 129 + i.x;
 return lerp(lerp(field[k], field[k+1], t.x),
             lerp(field[k+129], field[k+130], t.x), t.y);
}
[numthreads(16,16,1)]
void main(uint3 id : SV_DispatchThreadID) {
 if (id.x >= ow || id.y >= oh) return;
 float dx = (((id.x + 0.5) / ow - 0.5) * cw + offsetX) * flip;
 float dy = ((id.y + 0.5) / oh - 0.5) * ch + offsetY;
 float2 p = float2(cosine*dx+sine*dy+sw*0.5-0.5,
                  -sine*dx+cosine*dy+sh*0.5-0.5);
 p += displacement((p+0.5)/float2(sw,sh))*float2(sw,sh);
 int2 base = (int2)floor(p);
 float2 t = p - base;
 float4 sum = 0;
 [unroll] for (int y=0;y<2;y++) [unroll] for (int x=0;x<2;x++) {
   int2 q = clamp(base+int2(x,y), int2(0,0), int2(sw-1,sh-1));
   float4 v = picture[q.y*sw+q.x];
   float w = (x == 0 ? 1-t.x : t.x)*(y == 0 ? 1-t.y : t.y);
   sum += float4(v.rgb*v.a,v.a)*w;
 }
 if (sum.a > 0) sum.rgb /= sum.a;
 result[id.y*ow+id.x] = sum;
}";
    public GpuGeometry()
    {
        uint level;
        // HARDWARE only: never silently substitute the CPU WARP device.
        Check(D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0,
            new uint[] { 0xb000 }, 1, 7, out device, out level, out context));
        IntPtr blob = IntPtr.Zero, errors = IntPtr.Zero;
        try {
            byte[] code = Encoding.UTF8.GetBytes(Hlsl);
            int hr = D3DCompile(code, (UIntPtr)code.Length, "GpuGeometry", IntPtr.Zero,
                IntPtr.Zero, "main", "cs_5_0", 1 << 15, 0, out blob, out errors);
            if (hr < 0 && errors != IntPtr.Zero)
                throw new Exception(Marshal.PtrToStringAnsi(Method<BlobPointer>(errors, 3)(errors)));
            Check(hr);
            Check(Method<CreateShader>(device, 18)(device,
                Method<BlobPointer>(blob, 3)(blob), Method<BlobSize>(blob, 4)(blob), IntPtr.Zero, out shader));
        } finally { Release(ref errors); Release(ref blob); }
        field = Buffer(MapBytes, 8, 8, 0, null);
        fieldView = View(field, MapBytes / 8, false);
        constants = Buffer(48, 0, 4, 0, null);
    }
    IntPtr Buffer(int bytes, uint stride, uint bind, uint usage, byte[] data)
    {
        var desc = new BufferDesc { Size = (uint)bytes, Usage = usage, Bind = bind,
            CPU = usage == 3 ? 0x20000u : 0u, Misc = stride == 0 ? 0u : 0x40u, Stride = stride };
        IntPtr buffer, initial = IntPtr.Zero;
        GCHandle pinned = new GCHandle();
        try {
            if (data != null) {
                pinned = GCHandle.Alloc(data, GCHandleType.Pinned);
                initial = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Initial)));
                Marshal.StructureToPtr(new Initial { Data = pinned.AddrOfPinnedObject() }, initial, false);
            }
            Check(Method<CreateBuffer>(device, 3)(device, ref desc, initial, out buffer));
            return buffer;
        } finally {
            if (initial != IntPtr.Zero) Marshal.FreeHGlobal(initial);
            if (pinned.IsAllocated) pinned.Free();
        }
    }
    IntPtr View(IntPtr buffer, int elements, bool writable)
    {
        IntPtr desc = Marshal.AllocHGlobal(24);
        try {
            for (int i = 0; i < 24; i += 4) Marshal.WriteInt32(desc, i, 0);
            Marshal.WriteInt32(desc, 4, 1); // BUFFER
            Marshal.WriteInt32(desc, 12, elements);
            IntPtr view;
            Check(Method<CreateView>(device, writable ? 8 : 7)(device, buffer, desc, out view));
            return view;
        } finally { Marshal.FreeHGlobal(desc); }
    }
    void Upload(IntPtr buffer, byte[] bytes)
    {
        var pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try { Method<Update>(context, 48)(context, buffer, 0, IntPtr.Zero, pinned.AddrOfPinnedObject(), 0, 0); }
        finally { pinned.Free(); }
    }
    static byte[] Read(BinaryReader reader, int size)
    {
        byte[] bytes = reader.ReadBytes(size);
        if (bytes.Length != size) throw new EndOfStreamException();
        return bytes;
    }
    public void Run(BinaryReader input, BinaryWriter writer)
    {
        while (true) {
            uint magic;
            try { magic = input.ReadUInt32(); } catch (EndOfStreamException) { return; }
            if (magic != 0x48475032) throw new Exception("Invalid GPU protocol");
            int sw = input.ReadInt32(), sh = input.ReadInt32(), ow = input.ReadInt32(), oh = input.ReadInt32();
            int uploadBytes = input.ReadInt32();
            if (sw < 1 || sh < 1 || ow < 1 || oh < 1 || (long)sw*sh > 32000000 || (long)ow*oh > 32000000)
                throw new Exception("GPU image exceeds 32MP");
            int bytes = checked(sw*sh*16), resultBytes = checked(ow*oh*16);
            if (uploadBytes != 0 && uploadBytes != bytes) throw new Exception("Invalid GPU source length");
            byte[] config = new byte[48];
            using (var c = new BinaryWriter(new MemoryStream(config))) {
                c.Write(sw); c.Write(sh); c.Write(ow); c.Write(oh);
                for (int i=0;i<7;i++) {
                    float value = input.ReadSingle();
                    if (float.IsNaN(value) || float.IsInfinity(value)) throw new Exception("Invalid GPU geometry");
                    c.Write(value);
                }
            }
            byte[] map = Read(input, MapBytes);
            if (uploadBytes != 0) {
                byte[] pixels = Read(input, uploadBytes);
                Release(ref sourceView); Release(ref source);
                source = Buffer(bytes, 16, 8, 0, pixels);
                sourceView = View(source, bytes/16, false);
                sourceBytes = bytes;
            }
            if (source == IntPtr.Zero || sourceBytes != bytes) throw new Exception("GPU source is not cached");
            if (outputBytes != resultBytes) {
                Release(ref outputView); Release(ref output); Release(ref staging);
                output = Buffer(resultBytes, 16, 0x80, 0, null);
                outputView = View(output, resultBytes/16, true);
                staging = Buffer(resultBytes, 0, 0, 3, null);
                outputBytes = resultBytes;
            }
            Upload(field, map); Upload(constants, config);
            Method<SetResources>(context, 67)(context, 0, 2, new IntPtr[] { sourceView, fieldView });
            Method<SetResources>(context, 71)(context, 0, 1, new IntPtr[] { constants });
            Method<SetShader>(context, 69)(context, shader, IntPtr.Zero, 0);
            Method<SetUAV>(context, 68)(context, 0, 1, new IntPtr[] { outputView }, IntPtr.Zero);
            Method<Dispatch>(context, 41)(context, (uint)((ow+15)/16), (uint)((oh+15)/16), 1);
            Method<SetUAV>(context, 68)(context, 0, 1, new IntPtr[] { IntPtr.Zero }, IntPtr.Zero);
            Method<SetResources>(context, 67)(context, 0, 2, new IntPtr[] { IntPtr.Zero, IntPtr.Zero });
            Method<CopyResource>(context, 47)(context, staging, output);
            Mapped mapped;
            Check(Method<Map>(context, 14)(context, staging, 0, 1, 0, out mapped));
            byte[] result = new byte[resultBytes];
            try { Marshal.Copy(mapped.Data, result, 0, result.Length); }
            finally { Method<Unmap>(context, 15)(context, staging, 0); }
            writer.Write(result.Length); writer.Write(result); writer.Flush();
        }
    }
    public void Dispose()
    {
        Release(ref sourceView); Release(ref source); Release(ref fieldView); Release(ref field);
        Release(ref outputView); Release(ref output); Release(ref staging); Release(ref constants);
        Release(ref shader); Release(ref context); Release(ref device);
    }
    static int Main()
    {
        try {
            using (var gpu = new GpuGeometry())
            using (var input = new BinaryReader(Console.OpenStandardInput()))
            using (var output = new BinaryWriter(Console.OpenStandardOutput())) gpu.Run(input, output);
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
    }
}
