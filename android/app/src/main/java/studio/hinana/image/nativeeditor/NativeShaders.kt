package studio.hinana.image.nativeeditor

object NativeShaders {
    const val vertex =
        """#version 300 es
        layout(location=0) in vec2 position;
        out vec2 uv;
        void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0,1);}
    """
    const val fragment =
        """#version 300 es
precision highp float;
uniform sampler2D source;
uniform sampler2D gainmap;
uniform sampler2D coverage;
uniform sampler2D warpMap;
uniform float warpEnabled;
uniform vec2 dimensions;
uniform vec2 outputSize;
uniform vec2 tileOrigin;
uniform vec2 tileSize;
uniform vec4 viewport;
uniform float rotation;
uniform float flip;
uniform float sourceOrientation;
uniform float exposure;
uniform vec4 light;
uniform vec4 balance;
uniform vec4 finish;
uniform vec3 curveAdjustment;
uniform vec3 bands[8];
uniform vec3 skinSettings;
uniform vec4 pixelStep;
uniform float p3;
uniform float inputFloat;
uniform float legacy;
uniform float hdr;
uniform float hdrPeak;
uniform float hdrHighlights;
uniform float proof;
uniform float compare;
uniform float pass;
uniform int maskCount;
uniform vec4 maskEdits[8];
uniform vec4 maskFlags[8];
uniform float maskOverlay;
uniform vec4 localEdit;
uniform vec2 localFlags;
uniform vec3 gainMin;
uniform vec3 gainMax;
uniform vec3 gainGamma;
uniform vec3 epsilonSdr;
uniform vec3 epsilonHdr;
uniform float gainEnabled;
uniform float gainP3;
uniform float exportMode;
uniform float outputP3;
in vec2 uv;
out vec4 pixel;
float enc(float x){return sign(x)*(abs(x)<=0.0031308?abs(x)*12.92:1.055*pow(abs(x),1.0/2.4)-0.055);}
float dec(float x){return sign(x)*(abs(x)<=0.04045?abs(x)/12.92:pow((abs(x)+0.055)/1.055,2.4));}
vec3 enc3(vec3 x){return vec3(enc(x.r),enc(x.g),enc(x.b));}
vec3 dec3(vec3 x){return vec3(dec(x.r),dec(x.g),dec(x.b));}
vec3 toP3(vec3 c){return mat3(0.8225929,0.0331995,0.0170853,0.177534,0.9667835,0.0723957,0,0,0.9103015)*c;}
vec3 toSrgb(vec3 c){return mat3(1.224745,-0.042058,-0.019642,-0.224904,1.042081,-0.078655,0,0,1.098537)*c;}
vec4 sampleSource(vec2 p){
    vec4 s=texture(source,p);vec3 c=dec3(s.rgb/max(s.a,0.00001));
    if(gainEnabled>0.5){if(gainP3>.5)c=toP3(c);vec3 g=pow(texture(gainmap,p).rgb,gainGamma);c=(c+epsilonSdr)*exp(mix(log(gainMin),log(gainMax),g))-epsilonHdr;if(gainP3>.5)c=toSrgb(c);}
    if(p3>0.5)c=toP3(c);
    c=legacy>0.5?dec3(round(clamp(enc3(c),0.0,1.0)*255.0)/255.0):c*exp2(exposure);
    return vec4(c,s.a);
}
float skinWeight(vec3 c){if(p3>0.5)c=enc3(toSrgb(dec3(c/255.0)))*255.0;
    float y=dot(c,vec3(.299,.587,.114)),cb=128.0+dot(c,vec3(-.168736,-.331264,.5)),cr=128.0+dot(c,vec3(.5,-.418688,-.081312));
    return smoothstep(25.0,55.0,y)*(1.0-smoothstep(235.0,255.0,y))*smoothstep(75.0,88.0,cb)*(1.0-smoothstep(126.0,140.0,cb))*smoothstep(130.0,142.0,cr)*(1.0-smoothstep(175.0,190.0,cr));}
float cv(float x){float t=x/255.0;int i=int(clamp(floor(t*4.0),0.0,3.0));float v[5]=float[5](0.0,.25+curveAdjustment.x*.002,.5+curveAdjustment.y*.002,.75+curveAdjustment.z*.002,1.0);return max(0.0,(v[i]+(v[i+1]-v[i])*(t-float(i)*.25)*4.0)*255.0);}
vec3 adjust(vec3 c,vec2 coord){
    vec3 weights=p3>0.5?vec3(.2289746,.6917385,.0792869):vec3(.2126,.7152,.0722);
    float l=dot(c,weights)/255.0,shadow=pow(1.0-min(1.0,l),3.0),high=pow(min(1.0,l),3.0);
    float shift=light.y*shadow*.85+light.z*high*.85+light.w*high*high*.6+balance.x*shadow*shadow*.6;
    c=(c+shift-128.0)*pow(1.0+light.x/100.0,2.0)+128.0+vec3(balance.y*.65+balance.z*.24,-balance.z*.36,-balance.y*.65+balance.z*.24);
    float gray=dot(c,weights),chroma=(max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)))/255.0;
    c=gray+(c-gray)*(1.0+balance.w/100.0)*(1.0+finish.x/100.0*(1.0-min(1.0,chroma)));
    vec2 xy=(coord-0.5/outputSize)*2.0-1.0;float v=1.0-pow(min(1.0,dot(xy,xy)/1.5),1.5)*finish.z/100.0*.85;
    c=max(vec3(0),(c*(1.0-finish.y/200.0)+finish.y*.4)*v);if(legacy>.5)c=round(clamp(c,0.0,255.0));
    float gain=max(1.0,max(c.r,max(c.g,c.b))/255.0);vec3 n=c/(255.0*gain);float hi=max(n.r,max(n.g,n.b)),lo=min(n.r,min(n.g,n.b)),d=hi-lo;
    if(d>.0001){float h=hi==n.r?mod((n.g-n.b)/d+6.0,6.0)*60.0:hi==n.g?((n.b-n.r)/d+2.0)*60.0:((n.r-n.g)/d+4.0)*60.0;
        float lum=(hi+lo)/2.0,sat=d/(1.0-abs(2.0*lum-1.0));float hues[9]=float[9](0.0,30.0,60.0,120.0,180.0,240.0,270.0,300.0,360.0);int left=7;
        for(int j=0;j<7;j++)if(h>=hues[j]&&h<hues[j+1])left=j;float t=(h-hues[left])/(hues[left+1]-hues[left]);vec3 a=mix(bands[left],bands[(left+1)%8],t*t*(3.0-2.0*t));
        if(any(notEqual(a,vec3(0)))){h=mod(h+a.x*.3+360.0,360.0);float w=min(1.0,sat/.15);sat=clamp(sat*(1.0+a.y/100.0),0.0,1.0);lum=clamp(lum+a.z*.0035*w,0.0,1.0);
            float ch=(1.0-abs(2.0*lum-1.0))*sat,x=ch*(1.0-abs(mod(h/60.0,2.0)-1.0)),m=lum-ch/2.0;
            c=((h<60.0?vec3(ch,x,0):h<120.0?vec3(x,ch,0):h<180.0?vec3(0,ch,x):h<240.0?vec3(0,x,ch):h<300.0?vec3(x,0,ch):vec3(ch,0,x))+m)*255.0*gain;}}
    if(any(notEqual(curveAdjustment,vec3(0))))c=vec3(cv(c.r),cv(c.g),cv(c.b));if(legacy>.5)c=round(clamp(c,0.0,255.0));return dec3(max(vec3(0),c/255.0));
}
float pq(float x){float y=pow(clamp(x*203.0/10000.0,0.0,1.0),2610.0/16384.0);return pow((3424.0/4096.0+2413.0/128.0*y)/(1.0+2392.0/128.0*y),2523.0/32.0);}
vec2 orientedCoordinate(vec2 p){
    float angle=radians(rotation),cs=round(cos(angle)),sn=round(sin(angle));vec2 d=(p-.5)*outputSize;d.x*=flip>.5?-1.0:1.0;
    p=vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y)/dimensions+.5;
    return p;
}
vec2 displacement(vec2 p) {
    vec2 g=clamp(p,0.0,1.0)*128.0;ivec2 i=ivec2(min(floor(g),vec2(127)));vec2 t=g-vec2(i);
    return mix(mix(texelFetch(warpMap,i,0).rg,texelFetch(warpMap,i+ivec2(1,0),0).rg,t.x),mix(texelFetch(warpMap,i+ivec2(0,1),0).rg,texelFetch(warpMap,i+ivec2(1,1),0).rg,t.x),t.y);
}
vec2 rawCoordinate(vec2 p){
    p=orientedCoordinate(p);
    if(warpEnabled>.5 && compare<.5)p=clamp(p+displacement(p),0.0,1.0);
    if(sourceOrientation==2.0)p.x=1.0-p.x;
    if(sourceOrientation==3.0)p=1.0-p;
    if(sourceOrientation==4.0)p.y=1.0-p.y;
    if(sourceOrientation==5.0)p=p.yx;
    if(sourceOrientation==6.0)p=vec2(p.y,1.0-p.x);
    if(sourceOrientation==7.0)p=1.0-p.yx;
    if(sourceOrientation==8.0)p=vec2(1.0-p.y,p.x);
    return p;
}
void main(){
    vec2 screen=vec2(uv.x,1.0-uv.y),coord=(screen-viewport.xy)/viewport.zw;
    if(any(lessThan(coord,vec2(0)))||any(greaterThan(coord,vec2(1)))){pixel=vec4(.07,.08,.085,1);return;}
    vec2 world=rawCoordinate(coord),p=(world-tileOrigin)/tileSize;
    vec4 s=sampleSource(p);vec3 c=s.rgb;
    if(compare<.5){
        vec3 encoded=enc3(max(vec3(0),c))*255.0;
        float mask=skinWeight(encoded);
        if(skinSettings.x>0.0 && mask>.01){vec3 blur=vec3(0);float total=0.0;
            for(int y=-2;y<=2;y++){
                vec2 rowPosition=p+pixelStep.zw*float(y);vec4 originalY=sampleSource(rowPosition);vec3 guide=enc3(max(vec3(0),originalY.rgb))*255.0,rowColor=guide;
                if(skinWeight(guide)>=.01 && originalY.a>0.0){vec3 sum=vec3(0);float rowTotal=0.0;
                    for(int x=-2;x<=2;x++){vec4 originalX=sampleSource(rowPosition+pixelStep.xy*float(x));vec3 v=enc3(max(vec3(0),originalX.rgb))*255.0,delta=guide-v;float difference=dot(delta,delta)/(3.0*22.0*22.0);float w=(x==0?1.0:abs(x)==1?.8:.4)/(1.0+difference*difference)*originalX.a;sum+=v*w;rowTotal+=w;}
                    rowColor=sum/max(.00001,rowTotal);if(legacy>.5)rowColor=round(clamp(rowColor,0.0,255.0));
                }
                vec3 delta=encoded-guide;float difference=dot(delta,delta)/(3.0*22.0*22.0);float w=(y==0?1.0:abs(y)==1?.8:.4)/(1.0+difference*difference)*originalY.a;blur+=rowColor*w;total+=w;
            }
            vec3 smoothed=blur/max(.00001,total);if(legacy>.5)smoothed=round(clamp(smoothed,0.0,255.0));encoded=mix(encoded,smoothed,mask*skinSettings.x/100.0*.85);
        }
        float red=max(0.0,encoded.r-encoded.g-18.0)*mask*skinSettings.y/100.0*.45;
        encoded+=vec3(-red,red*.45,red*.2)+mask*skinSettings.z/100.0*18.0;
        if(legacy>.5)encoded=round(clamp(encoded,0.0,255.0))*exp2(exposure);
        c=adjust(encoded,coord);
    }
    if(compare<.5){vec2 maskCoord=orientedCoordinate(coord);vec3 weights=p3>.5?vec3(.2289746,.6917385,.0792869):vec3(.2126,.7152,.0722);
      for(int i=0;i<8;i++){if(i>=maskCount)break;vec4 flags=maskFlags[i];if(flags.z<.5)continue;float f=texture(coverage,vec2(maskCoord.x,(maskCoord.y+float(i))/float(maskCount))).r;if(flags.x>.5)f=1.0-f;f*=flags.y;
        vec4 a=maskEdits[i];vec3 changed=(c*exp2(a.x)-.18)*pow(1.0+a.y/100.0,2.0)+.18;changed*=vec3(exp2(a.w*.003),1,exp2(-a.w*.003));float grey=dot(changed,weights);changed=grey+(changed-grey)*(1.0+a.z/100.0);c=mix(c,max(vec3(0),changed),f);
        if(maskOverlay>.5&&flags.w>.5)c=mix(c,vec3(1,.15,.4),f*.32);
      }
    }
    float peak=max(c.r,max(c.g,c.b));if(hdr>.5 && peak>.6 && peak<hdrPeak/203.0){float t=min(1.0,(peak-.6)/.4);float target=peak+(hdrPeak/203.0-peak)*hdrHighlights/100.0*t*t*(3.0-2.0*t);c*=target/peak;}
    if(proof>.5 && hdr>.5){peak=max(c.r,max(c.g,c.b));float mapped=peak<=.5?peak:.5+.5*(1.0-exp(-2.0*(peak-.5)));if(peak>0.0)c*=mapped/peak;}
    if(p3>.5 && (outputP3<.5 || exportMode>1.5))c=toSrgb(c);
    if(p3<.5 && outputP3>.5 && exportMode<1.5)c=toP3(c);
    if(exportMode>1.5){c=mat3(.627404,.069097,.016391,.329283,.919541,.088013,.043313,.011362,.895595)*c;c=clamp(c,vec3(0),vec3(hdrPeak/203.0));c=vec3(pq(c.r),pq(c.g),pq(c.b));}
    else if(exportMode<.5)c=enc3(c);
    pixel=vec4(c,s.a);
}
    """
}
