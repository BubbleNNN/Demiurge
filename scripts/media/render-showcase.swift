import Foundation
import AppKit
import ImageIO
import AVFoundation
import CoreVideo

let root = URL(fileURLWithPath: CommandLine.arguments[1])
let out = root.appendingPathComponent("docs/media")
let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("shared/cyrene-motion-pack.json"))) as! [String:Any]
struct Style {
 let name: String; let image: CGImage; let frames: [[String:Any]]; let clips: [String:[String:Any]]; let aspect: CGFloat; let pixel: Bool
}
var styles: [String:Style] = [:]
for entry in catalog["entries"] as! [[String:Any]] {
 let a=entry["animation"] as! [String:Any]
 let source=CGImageSourceCreateWithURL(root.appendingPathComponent("public/art/"+(entry["file"] as! String)) as CFURL,nil)!
 let name=entry["style"] as! String
 styles[name]=Style(name:name,image:CGImageSourceCreateImageAtIndex(source,0,nil)!,frames:a["frames"] as! [[String:Any]],clips:a["clips"] as! [String:[String:Any]],aspect:CGFloat(a["width"] as! Int)/CGFloat(a["height"] as! Int),pixel:a["pixelated"] as? Bool ?? false)
}
func color(_ hex: UInt32) -> CGColor { CGColor(red:CGFloat((hex>>16)&255)/255,green:CGFloat((hex>>8)&255)/255,blue:CGFloat(hex&255)/255,alpha:1) }
func rect(_ c:CGContext,_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat,_ fill:UInt32,_ radius:CGFloat=0) {
 c.setFillColor(color(fill)); c.addPath(CGPath(roundedRect:CGRect(x:x,y:y,width:w,height:h),cornerWidth:radius,cornerHeight:radius,transform:nil));c.fillPath()
}
func text(_ c:CGContext,_ value:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ hex:UInt32=0x34273E,_ bold:Bool=false,_ width:CGFloat=1100) {
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:c,flipped:false)
 let attrs:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:size,weight:bold ? .semibold : .regular),.foregroundColor:NSColor(cgColor:color(hex))!]
 (value as NSString).draw(in:CGRect(x:x,y:y,width:width,height:size*2.6),withAttributes:attrs)
 NSGraphicsContext.restoreGraphicsState()
}
func frame(_ s:Style,_ action:String,_ time:Double)->Int {
 let clip=s.clips[action] ?? s.clips["idle"]!
 let ids=clip["frames"] as! [Int]
 let durations=(clip["durations"] as? [Int]) ?? ids.map {s.frames[$0]["duration"] as! Int}
 let sum=durations.reduce(0,+)
 var age=Int(time*1000)
 if clip["loop"] as? Bool == true {age %= sum} else if age>=sum {return ids.last!}
 for (i,d) in durations.enumerated(){if age<d{return ids[i]};age-=d}
 return ids.last!
}
func pet(_ c:CGContext,_ style:String,_ action:String,_ time:Double,_ box:CGRect) {
 let s=styles[style]!,idx=frame(s,action,time)
 let r=s.frames[idx]["rect"] as! [Int]
 let crop=s.image.cropping(to:CGRect(x:r[0],y:r[1],width:r[2],height:r[3]))!
 var h=box.height,w=h*s.aspect;if w>box.width{w=box.width;h=w/s.aspect}
 if s.pixel { let scale=max(1,floor(h/CGFloat((style=="8bit") ? 128 : 96)));h=scale*CGFloat(style=="8bit" ? 128 : 96);w=h*s.aspect }
 c.interpolationQuality=s.pixel ? .none : .high
 c.draw(crop,in:CGRect(x:box.midX-w/2,y:box.minY,width:w,height:h))
}
let sequence:[(String,Double)] = [("idle",1.0),("wave",2.0),("blink",0.35),("talk",1.2),("nod",1.0),("sleep",1.8),("idle",0.65)]
func actionAt(_ t:Double)->(String,Double){var t=t.truncatingRemainder(dividingBy:8);for(a,d) in sequence{if t<d{return(a,t)};t-=d};return("idle",0)}
func context(_ w:Int,_ h:Int)->CGContext{CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!}
func background(_ c:CGContext,_ w:CGFloat,_ h:CGFloat){rect(c,0,0,w,h,0xF8F4FA);rect(c,24,24,w-48,h-48,0xFFFFFF,24)}
func gif(_ filename:String,_ kind:String,_ w:Int,_ h:Int) {
 let dest=CGImageDestinationCreateWithURL(out.appendingPathComponent(filename) as CFURL,"com.compuserve.gif" as CFString,96,nil)!
 CGImageDestinationSetProperties(dest,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFLoopCount:0]] as CFDictionary)
 for i in 0..<96 {autoreleasepool {
 let c=context(w,h);background(c,CGFloat(w),CGFloat(h));let t=Double(i)/12;let(a,age)=actionAt(t)
 if kind=="styles" {
 text(c,"One character. Four different looks.",44,CGFloat(h)-84,27,0x34273E,true)
 for (index,key) in ["original","8bit","3d","powerpuff"].enumerated(){let x=CGFloat(index)*220+42;rect(c,x,66,208,CGFloat(h)-168,0xF6F1F8,16);pet(c,key,a,age,CGRect(x:x+12,y:98,width:184,height:CGFloat(h)-220));text(c,["Original","8-bit","Low-poly look","Cartoon"][index],x+18,68,15,0x725A83,false,190)}
 } else {
 text(c,"Cyrene / "+(kind=="8bit" ? "8-bit" : kind=="powerpuff" ? "Cartoon" : "Original look"),42,CGFloat(h)-78,25,0x34273E,true)
 pet(c,kind,a,age,CGRect(x:56,y:65,width:CGFloat(w)-112,height:CGFloat(h)-155))
 text(c,["wave":"A little hello","nod":"A gentle nod","talk":"Talking frames","sleep":"Time to rest","blink":"Blink","idle":"Here with you"][a]!,42,28,14,0x8C6297)
 }
 CGImageDestinationAddImage(dest,c.makeImage()!,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFDelayTime:1.0/12.0,kCGImagePropertyGIFUnclampedDelayTime:1.0/12.0]] as CFDictionary)
 }}
 precondition(CGImageDestinationFinalize(dest));print("Wrote \(filename)")
}
gif("cyrene-original.gif","original",480,560)
gif("cyrene-8bit.gif","8bit",480,560)
gif("cyrene-cartoon.gif","powerpuff",480,560)
gif("cyrene-styles.gif","styles",960,470)

let videoURL=out.appendingPathComponent("demiurge-intro.mp4")
try? FileManager.default.removeItem(at:videoURL)
let writer=try AVAssetWriter(outputURL:videoURL,fileType:.mp4)
let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:1280,AVVideoHeightKey:720,AVVideoCompressionPropertiesKey:[AVVideoAverageBitRateKey:2200000,AVVideoProfileLevelKey:AVVideoProfileLevelH264HighAutoLevel]])
let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:1280,kCVPixelBufferHeightKey as String:720,kCVPixelBufferCGImageCompatibilityKey as String:true,kCVPixelBufferCGBitmapContextCompatibilityKey as String:true])
writer.add(input);writer.startWriting();writer.startSession(atSourceTime:.zero)
let titles=["A little company, on your desktop.","One character. Many ways to meet.","Small gestures make a difference.","Let the quiet moments stay quiet.","Make a companion of your own."]
let subtitles=["Meet Cyrene in Demiurge.","Original, 8-bit, low-poly look and cartoon.","Wave, blink, nod and talk with authored frames.","Local routines keep a task, take a break and return.","Reference images → choose a look → review motions → desktop."]
for i in 0..<768 {
 while !input.isReadyForMoreMediaData {Thread.sleep(forTimeInterval:0.002)}
 autoreleasepool {
 var buffer:CVPixelBuffer?;CVPixelBufferPoolCreatePixelBuffer(nil,adaptor.pixelBufferPool!,&buffer);let b=buffer!;CVPixelBufferLockBaseAddress(b,[])
 let c=CGContext(data:CVPixelBufferGetBaseAddress(b),width:1280,height:720,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(b),space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipFirst.rawValue)!
 let t=Double(i)/24,scene=min(4,Int(t/6.4)),local=t-Double(scene)*6.4
 background(c,1280,720);text(c,"D E M I U R G E",58,630,20,0x9B6CA8,true)
 text(c,titles[scene],58,552,39,0x34273E,true)
 text(c,subtitles[scene],60,518,19,0x7B6B85,false)
 if scene==1 {
 let(a,age)=actionAt(local)
 for(index,key) in ["original","8bit","3d","powerpuff"].enumerated(){let x=CGFloat(index)*294+58;rect(c,x,146,280,345,0xF6F1F8,20);pet(c,key,a,age,CGRect(x:x+18,y:172,width:244,height:292));text(c,["Original","8-bit","Low-poly look","Cartoon"][index],x+20,146,17,0x725A83)}
 } else if scene==2 || scene==3 {
 for(index,key) in ["original","8bit","powerpuff"].enumerated(){let x=CGFloat(index)*390+58;rect(c,x,146,374,345,0xF6F1F8,20);let action=scene==3 ? ["sleep","idle","sleep"][index] : ["wave","nod","talk"][index];pet(c,key,action,local.truncatingRemainder(dividingBy:2.5),CGRect(x:x+32,y:172,width:310,height:292));text(c,scene==3 ? ["Rest","A moment of calm","Stay awhile"][index] : ["Wave","Nod","Talk"][index],x+24,146,18,0x725A83)}
 } else {
 pet(c,"original",scene==0 ? "wave" : "nod",local.truncatingRemainder(dividingBy:3),CGRect(x:74,y:130,width:340,height:370))
 let lines=scene==0 ? ["Local-first character companion","Your characters, your models","Small gestures. A little everyday life."] : ["Keep identity and style references distinct","Choose and correct your character image","Review each motion before activation"]
 for(index,line) in lines.enumerated(){let y=CGFloat(365-index*84);rect(c,490,y-5,690,65,0xF6F1F8,14);text(c,line,512,y+6,21,0x5C426E)}
 }
 text(c,"Cyrene fan-art sprite showcase · actual bundled motion frames",60,82,14,0x88778F)
 text(c,"github.com/BubbleNNN/Demiurge",60,50,17,0x725A83,true)
 rect(c,58,28,1164,3,0xEBE2EF);rect(c,58,28,1164*CGFloat(t/32),3,0xAE7DB7)
 if i==0 {let png=CGImageDestinationCreateWithURL(out.appendingPathComponent("demiurge-intro-poster.png") as CFURL,"public.png" as CFString,1,nil)!;CGImageDestinationAddImage(png,c.makeImage()!,nil);CGImageDestinationFinalize(png)}
 CVPixelBufferUnlockBaseAddress(b,[]);precondition(adaptor.append(b,withPresentationTime:CMTime(value:Int64(i),timescale:24)))
 }
}
input.markAsFinished();let done=DispatchSemaphore(value:0);writer.finishWriting{done.signal()};done.wait();precondition(writer.status == .completed,writer.error?.localizedDescription ?? "video failed");print("Wrote 32-second intro video")
