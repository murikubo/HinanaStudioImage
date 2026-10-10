#include <metal_stdlib>
#include <CoreImage/CoreImage.h>
using namespace metal;
float enc(float x) { return x <= 0.0031308f ? 12.92f*x : 1.055f*pow(max(0.0f,x),1.0f/2.4f)-0.055f; }
float dec(float x) { return x <= 0.04045f ? x/12.92f : pow((x+0.055f)/1.055f,2.4f); }
float3 enc3(float3 x) { return float3(enc(x.r),enc(x.g),enc(x.b)); }
float3 dec3(float3 x) { return float3(dec(x.r),dec(x.g),dec(x.b)); }
float skin(float3 c, float p3) {
    if (p3 > .5f) { float3 v=dec3(c/255); c=enc3(float3(1.224745f*v.r-.224904f*v.g, -.042058f*v.r+1.042081f*v.g, -.019642f*v.r-.078655f*v.g+1.098537f*v.b))*255; }
    float y=dot(c,float3(.299f,.587f,.114f)), cb=128+dot(c,float3(-.168736f,-.331264f,.5f)), cr=128+dot(c,float3(.5f,-.418688f,-.081312f));
    return smoothstep(25.0f,55.0f,y)*(1-smoothstep(235.0f,255.0f,y))*smoothstep(75.0f,88.0f,cb)*(1-smoothstep(126.0f,140.0f,cb))*smoothstep(130.0f,142.0f,cr)*(1-smoothstep(175.0f,190.0f,cr));
}
float curve(float v, float3 adjustment) {
    float x=v/255, seg=clamp(floor(x*4),0.0f,3.0f);
    float ys[5]={0,.25f+adjustment.x*.002f,.5f+adjustment.y*.002f,.75f+adjustment.z*.002f,1};
    int i=int(seg); return max(0.0f,(ys[i]+(ys[i+1]-ys[i])*(x-seg*.25f)*4)*255);
}
extern "C" { namespace coreimage {
float4 nativeQuantize(sample_t s) {if(s.a<=0)return s;return float4(dec3(rint(clamp(enc3(s.rgb/s.a),0.0f,1.0f)*255)/255)*s.a,s.a);}
float4 nativeExposure(sample_t s, float exposure, float legacy) {
    float3 c=s.a > 0 ? s.rgb/s.a : float3(0);
    c = legacy > .5f ? dec3(enc3(c)*exp2(exposure)) : c*exp2(exposure);
    return float4(c*s.a,s.a);
}
float4 nativeEdit(sample_t s, float4 light, float4 balance, float4 finish, float4 mode, float3 tone,
                  float3 red, float3 orange, float3 yellow, float3 green, float3 aqua, float3 blue, float3 purple, float3 magenta, destination dest) {
    if (s.a <= 0) return s;
    float3 c=enc3(max(float3(0),s.rgb/s.a))*255;
    float3 weights=mode.z > .5f ? float3(.2289746f,.6917385f,.0792869f) : float3(.2126f,.7152f,.0722f);
    float l=dot(c,weights)/255, shadow=pow(1-min(1.0f,l),3.0f), high=pow(min(1.0f,l),3.0f);
    float shift=light.y*shadow*.85f+light.z*high*.85f+light.w*high*high*.6f+balance.x*shadow*shadow*.6f;
    c=(c+shift-128)*pow(1+light.x/100,2.0f)+128+float3(balance.y*.65f+balance.z*.24f,-balance.z*.36f,-balance.y*.65f+balance.z*.24f);
    float gray=dot(c,weights), chroma=(max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)))/255;
    c=gray+(c-gray)*(1+balance.w/100)*(1+finish.x/100*(1-min(1.0f,chroma)));
    float2 xy=(dest.coord()-.5f)/mode.xy*2-1;
    float vignette=1-pow(min(1.0f,dot(xy,xy)/1.5f),1.5f)*finish.z/100*.85f;
    c=max(float3(0),(c*(1-finish.y/200)+finish.y*.4f)*vignette);
    if (mode.w > .5f) c=rint(clamp(c,0.0f,255.0f));
    float gain=max(1.0f,max(c.r,max(c.g,c.b))/255), hi=max(c.r,max(c.g,c.b))/(255*gain), lo=min(c.r,min(c.g,c.b))/(255*gain), d=hi-lo;
    float3 normalized=c/(255*gain);
    if (d > .0001f) {
        float h = hi==normalized.r ? fmod((normalized.g-normalized.b)/d+6,6.0f)*60 : hi==normalized.g ? ((normalized.b-normalized.r)/d+2)*60 : ((normalized.r-normalized.g)/d+4)*60;
        float lum=(hi+lo)/2, sat=d/(1-abs(2*lum-1));
        float hues[9]={0,30,60,120,180,240,270,300,360};
        float3 bands[8]={red,orange,yellow,green,aqua,blue,purple,magenta}; int left=7;
        for(int j=0;j<7;j++) if(h>=hues[j]&&h<hues[j+1]) left=j;
        float t=(h-hues[left])/(hues[left+1]-hues[left]); float3 a=mix(bands[left],bands[(left+1)%8],t*t*(3-2*t));
        if(any(a!=float3(0))) {
            h=fmod(h+a.x*.3f+360,360.0f); float cw=min(1.0f,sat/.15f);
            sat=clamp(sat*(1+a.y/100),0.0f,1.0f); lum=clamp(lum+a.z*.0035f*cw,0.0f,1.0f);
            float ch=(1-abs(2*lum-1))*sat, x=ch*(1-abs(fmod(h/60,2.0f)-1)), m=lum-ch/2;
            c=(h<60?float3(ch,x,0):h<120?float3(x,ch,0):h<180?float3(0,ch,x):h<240?float3(0,x,ch):h<300?float3(x,0,ch):float3(ch,0,x))*255*gain+m*255*gain;
        }
    }
    if(any(tone!=float3(0))) c=float3(curve(c.r,tone),curve(c.g,tone),curve(c.b,tone));
    if(mode.w>.5f)c=rint(clamp(c,0.0f,255.0f));
    return float4(dec3(max(float3(0),c/255))*s.a,s.a);
}
float4 nativeSkin(sampler original, sampler blurred, float4 settings, float legacy, destination dest) {
    float2 p=dest.coord(); float4 source=original.sample(original.transform(p)), b=blurred.sample(blurred.transform(p));
    if(source.a<=0) return source;
    float3 c=enc3(source.rgb/source.a)*255, smooth=enc3(b.rgb/max(b.a,.00001f))*255;
    float mask=skin(c,settings.w); c=mix(c,smooth,mask*settings.x/100*.85f);
    float red=max(0.0f,c.r-c.g-18)*mask*settings.y/100*.45f;
    c+=float3(-red,red*.45f,red*.2f)+mask*settings.z/100*18;
    if(legacy>.5f)c=rint(clamp(c,0.0f,255.0f));return float4(dec3(max(float3(0),c/255))*source.a,source.a);
}
float4 nativeBilateral(sampler original, sampler input, float4 direction, destination dest) {
    float2 p=dest.coord(); float4 center=original.sample(original.transform(p)); if(center.a<=0) return center;
    float3 c=enc3(center.rgb/center.a)*255, sum=0; if(skin(c,direction.z)<.01f)return input.sample(input.transform(p)); float total=0;
    for(int k=-2;k<=2;k++) { float2 q=p+direction.xy*float(k); float4 s=original.sample(original.transform(q)), b=input.sample(input.transform(q));
        float3 v=enc3(s.rgb/max(s.a,.00001f))*255, diff=c-v; float difference=dot(diff,diff)/(3*22*22);
        float weight=(k==0?1.0f:abs(k)==1?.8f:.4f)/(1+difference*difference)*s.a;
        sum+=enc3(b.rgb/max(b.a,.00001f))*255*weight; total+=weight;
    }
    float3 value=sum/max(total,.00001f);if(direction.w>.5f)value=rint(clamp(value,0.0f,255.0f));return float4(dec3(value/255)*center.a,center.a);
}
float4 nativeCoverage(float4 points, float4 geometry, float kind, destination dest) {
    float2 p=dest.coord(), a=points.xy, b=points.zw, delta=b-a; float length=max(.000001f,dot(delta,delta)); float dist;
    if(kind < .5f) dist=distance(p,a+delta*clamp(dot(p-a,delta)/length,0.0f,1.0f))/max(.5f,geometry.x);
    else if(kind < 1.5f) dist=dot(p-a,delta)/length;
    else dist=metal::length((p-a)/max(float2(.5f),abs(delta)));
    float v=dist>=1 ? 0 : geometry.y<=0 ? 1 : 1-smoothstep(1-geometry.y,1.0f,dist);
    return float4(v,v,v,1);
}
float4 nativeLocal(sample_t s, sample_t mask, float4 edit, float3 flags) {
    if(s.a<=0) return s; float coverage=mask.r; if(flags.x>.5f) coverage=1-coverage; coverage*=flags.y;
    float3 c=s.rgb/s.a, changed=(c*exp2(edit.x)-.18f)*pow(1+edit.y/100,2.0f)+.18f;
    changed*=float3(exp2(edit.w*.003f),1,exp2(-edit.w*.003f));
    float3 weights=flags.z>.5f?float3(.2289746f,.6917385f,.0792869f):float3(.2126f,.7152f,.0722f);
    changed=dot(changed,weights)+(changed-dot(changed,weights))*(1+edit.z/100);
    return float4(mix(c,max(float3(0),changed),coverage)*s.a,s.a);
}
float4 nativeRange(sample_t s, float4 settings) {
    if(s.a<=0) return s; float3 c=s.rgb/s.a; float peak=max(c.r,max(c.g,c.b)), limit=settings.y/203;
    if(settings.x>0 && peak>.6f && peak<limit) { float t=min(1.0f,(peak-.6f)/.4f); c*= (peak+(limit-peak)*settings.x/100*t*t*(3-2*t))/peak; }
    if(settings.z>.5f) { peak=max(c.r,max(c.g,c.b)); float mapped=peak<=.5f?peak:.5f+.5f*(1-exp(-2*(peak-.5f))); if(peak>0)c*=mapped/peak; }
    return float4(c*s.a,s.a);
}
float pq(float x) { float y=pow(clamp(x/10000.0f,0.0f,1.0f),2610.0f/16384.0f); return pow((3424.0f/4096.0f+2413.0f/128.0f*y)/(1+2392.0f/128.0f*y),2523.0f/32.0f); }
float4 nativePQ(sample_t s, float2 settings) {
    if(s.a<=0) return s; float3 c=s.rgb/s.a;
    if(settings.x>.5f)c=float3(1.224745f*c.r-.224904f*c.g,-.042058f*c.r+1.042081f*c.g,-.019642f*c.r-.078655f*c.g+1.098537f*c.b);
    c=float3(.627404f*c.r+.329283f*c.g+.043313f*c.b,.069097f*c.r+.919541f*c.g+.011362f*c.b,.016391f*c.r+.088013f*c.g+.895595f*c.b);
    c=clamp(c*203,float3(0),float3(settings.y)); return float4(float3(pq(c.r),pq(c.g),pq(c.b))*s.a,s.a);
}
float4 nativeLiquify(coreimage::sampler source, coreimage::sampler field, float2 dimensions, coreimage::destination dest) {
  float2 offset = field.sample(field.transform(dest.coord())).rg;
  float2 p = dest.coord() + float2(offset.x * dimensions.x, -offset.y * dimensions.y);
  p = clamp(p, float2(.5), dimensions - .5);
  return source.sample(source.transform(p));
}
}}
