import Foundation
import AVFoundation
import AppKit
import ImageIO
let root=URL(fileURLWithPath:CommandLine.arguments[1]),assets=URL(fileURLWithPath:CommandLine.arguments[2]),out=root.appendingPathComponent("docs/media")
let board=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("scripts/media/storyboard.json"))) as! [String:Any]
let duration=board["duration"] as! Double
func export(_ asset:AVAsset,_ preset:String,_ url:URL,_ type:AVFileType)throws{
 try? FileManager.default.removeItem(at:url)
 let e=AVAssetExportSession(asset:asset,presetName:preset)!;e.outputURL=url;e.outputFileType=type;e.shouldOptimizeForNetworkUse=true
 let d=DispatchSemaphore(value:0);e.exportAsynchronously{d.signal()};d.wait();guard e.status == .completed else{throw e.error ?? NSError(domain:"Export",code:1)}
}
let audioURL=assets.appendingPathComponent("soundtrack.m4a")
try export(AVURLAsset(url:assets.appendingPathComponent("soundtrack.wav")),AVAssetExportPresetAppleM4A,audioURL,.m4a)
var report:[[String:Any]]=[]
for layout in ["vertical","landscape"] {
 let movie=AVURLAsset(url:assets.appendingPathComponent(layout+"-silent.mp4")),sound=AVURLAsset(url:audioURL),composition=AVMutableComposition()
 let vt=movie.tracks(withMediaType:.video).first!,at=sound.tracks(withMediaType:.audio).first!
 let range=CMTimeRange(start:.zero,duration:movie.duration)
 try composition.addMutableTrack(withMediaType:.video,preferredTrackID:kCMPersistentTrackID_Invalid)!.insertTimeRange(range,of:vt,at:.zero)
 try composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid)!.insertTimeRange(range,of:at,at:.zero)
 let finalURL=out.appendingPathComponent("demiurge-desktop-life-\(layout).mp4")
 try export(composition,AVAssetExportPresetPassthrough,finalURL,.mp4)
 let final=AVURLAsset(url:finalURL),track=final.tracks(withMediaType:.video).first!
 let expected=layout=="vertical" ? CGSize(width:1080,height:1920):CGSize(width:1920,height:1080)
 precondition(track.naturalSize==expected);precondition(abs(final.duration.seconds-duration)<0.05);precondition(abs(track.nominalFrameRate-30)<0.01);precondition(final.tracks(withMediaType:.audio).count==1)
 let gen=AVAssetImageGenerator(asset:final);gen.appliesPreferredTrackTransform=true;gen.requestedTimeToleranceBefore = .zero;gen.requestedTimeToleranceAfter = .zero
 for (i,t) in [14.2,1.2,4.0,6.2,9.5,19.5,25.5,32.5,40.0,47.0,54.5,62.0,67.8,71.9,78.0,87.5,95.0,102.0,109.0].enumerated(){let img=try gen.copyCGImage(at:CMTime(seconds:t,preferredTimescale:600),actualTime:nil);let url=assets.appendingPathComponent("decoded-\(layout)-\(i).png");let dst=CGImageDestinationCreateWithURL(url as CFURL,"public.png" as CFString,1,nil)!;CGImageDestinationAddImage(dst,img,nil);precondition(CGImageDestinationFinalize(dst));if i==0{try? FileManager.default.removeItem(at:out.appendingPathComponent("demiurge-\(layout)-cover.png"));try FileManager.default.copyItem(at:url,to:out.appendingPathComponent("demiurge-\(layout)-cover.png"))}}
 // Decode the complete video track, not only container metadata.
 let reader=try AVAssetReader(asset:final),readerOutput=AVAssetReaderTrackOutput(track:track,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA]);reader.add(readerOutput);reader.startReading();var count=0;while readerOutput.copyNextSampleBuffer() != nil{count+=1};precondition(reader.status == .completed);precondition(count==Int((duration*30).rounded()))
 let bytes=(try FileManager.default.attributesOfItem(atPath:finalURL.path)[.size] as! NSNumber).intValue
 report.append(["file":finalURL.lastPathComponent,"width":Int(expected.width),"height":Int(expected.height),"duration":final.duration.seconds,"fps":track.nominalFrameRate,"decodedFrames":count,"audioTracks":1,"bytes":bytes,"optimizedForNetwork":true]);print("Validated \(layout): \(count) frames, audio, \(bytes) bytes");fflush(stdout)
}
for name in ["cyrene-chibi-work.gif","cyrene-chibi-life.gif","cyrene-chibi-desktop.gif","cyrene-chibi-rest.gif"] {let src=CGImageSourceCreateWithURL(out.appendingPathComponent(name) as CFURL,nil)!;let count=CGImageSourceGetCount(src);precondition(count>=60);for i in 0..<count{precondition(CGImageSourceCreateImageAtIndex(src,i,nil) != nil)};report.append(["file":name,"decodedFrames":count])}
try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:out.appendingPathComponent("validation.json"));print("Validation report written")
