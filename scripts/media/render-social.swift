import Foundation
import AppKit
import ImageIO
import AVFoundation
import CoreVideo

// Offline editorial renderer. Uses reviewed sprite frames, never generates new poses.
let root=URL(fileURLWithPath:CommandLine.arguments[1])
let assets=URL(fileURLWithPath:CommandLine.arguments[2])
let output=root.appendingPathComponent("docs/media")
let mode=CommandLine.arguments.count>3 ? CommandLine.arguments[3] : "preview"
let sprite=try JSONSerialization.jsonObject(with:Data(contentsOf:assets.appendingPathComponent("sprite.json"))) as! [String:Any]
let frames=sprite["frames"] as! [[String:Any]], clips=sprite["clips"] as! [String:[String:Any]]
let pageCount=(sprite["pages"] as! [[String:Any]]).count+1
let pages=(0..<pageCount).map{CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(assets.appendingPathComponent("atlas-\($0).png") as CFURL,nil)!,0,nil)!}
let crops=frames.map{f -> CGImage in let r=f["rect"] as! [Int];return pages[f["page"] as? Int ?? 0].cropping(to:CGRect(x:r[0],y:r[1],width:r[2],height:r[3]))!}
func load(_ name:String)->CGImage{CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(assets.appendingPathComponent(name) as CFURL,nil)!,0,nil)!}
let communityShare=load("community-share.png"),communityPlugins=load("community-plugins.png")
let ink:UInt32=0x34273E,pink:UInt32=0xB45583,muted:UInt32=0x827289
func col(_ hex:UInt32,_ a:CGFloat=1)->CGColor{CGColor(red:CGFloat((hex>>16)&255)/255,green:CGFloat((hex>>8)&255)/255,blue:CGFloat(hex&255)/255,alpha:a)}
func fill(_ c:CGContext,_ r:CGRect,_ hex:UInt32,_ radius:CGFloat=0,_ alpha:CGFloat=1){c.setFillColor(col(hex,alpha));c.addPath(CGPath(roundedRect:r,cornerWidth:radius,cornerHeight:radius,transform:nil));c.fillPath()}
func stroke(_ c:CGContext,_ r:CGRect,_ hex:UInt32,_ radius:CGFloat=0,_ width:CGFloat=1){c.setStrokeColor(col(hex));c.setLineWidth(width);c.addPath(CGPath(roundedRect:r,cornerWidth:radius,cornerHeight:radius,transform:nil));c.strokePath()}
func txt(_ c:CGContext,_ s:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ color:UInt32=0x34273E,_ bold:Bool=false,_ width:CGFloat=1000,_ center:Bool=false){
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:c,flipped:true)
 let p=NSMutableParagraphStyle();p.lineSpacing=size*0.12;p.alignment=center ? .center:.left;p.lineBreakMode = .byWordWrapping
 let font=NSFont(name:bold ? "PingFangSC-Semibold":"PingFangSC-Regular",size:size) ?? NSFont.systemFont(ofSize:size,weight:bold ? .semibold:.regular)
 (s as NSString).draw(in:CGRect(x:x,y:y,width:width,height:size*4.5),withAttributes:[.font:font,.foregroundColor:NSColor(cgColor:col(color))!,.paragraphStyle:p])
 NSGraphicsContext.restoreGraphicsState()
}
func image(_ c:CGContext,_ img:CGImage,_ box:CGRect){c.saveGState();c.translateBy(x:box.minX,y:box.maxY);c.scaleBy(x:1,y:-1);c.interpolationQuality = .high;c.draw(img,in:CGRect(x:0,y:0,width:box.width,height:box.height));c.restoreGState()}
func fit(_ c:CGContext,_ img:CGImage,_ box:CGRect){let s=min(box.width/CGFloat(img.width),box.height/CGFloat(img.height));image(c,img,CGRect(x:box.midX-CGFloat(img.width)*s/2,y:box.midY-CGFloat(img.height)*s/2,width:CGFloat(img.width)*s,height:CGFloat(img.height)*s))}
func clamp(_ v:Double)->Double{min(1,max(0,v))}
func ease(_ v:Double)->CGFloat{let x=clamp(v);return CGFloat(x*x*(3-2*x))}
func clipFrame(_ action:String,_ t:Double)->Int {
 let clip=clips[action]!,ids=clip["frames"] as! [Int],ds=(clip["durations"] as? [Int]) ?? ids.map{frames[$0]["duration"] as! Int};let sum=ds.reduce(0,+)
 var a=max(0,Int(t*1000));if clip["loop"] as? Bool == true {a %= sum}else if a>=sum{return ids.last!}
 for(i,d) in ds.enumerated(){if a<d{return ids[i]};a-=d};return ids.last!
}
var used=Set<String>()
func petFrame(_ c:CGContext,_ i:Int,_ box:CGRect){let f=frames[i],r=f["rect"] as! [Int],o=f["offset"] as! [Int],cell=f["cell"] as! [Int];let s=min(box.width/CGFloat(cell[0]),box.height/CGFloat(cell[1]));image(c,crops[i],CGRect(x:box.midX-CGFloat(cell[0])*s/2+CGFloat(o[0])*s,y:box.minY+CGFloat(o[1])*s,width:CGFloat(r[2])*s,height:CGFloat(r[3])*s))}
func pet(_ c:CGContext,_ action:String,_ t:Double,_ box:CGRect){used.insert(action);petFrame(c,clipFrame(action,t),box)}
func routine(_ c:CGContext,_ action:String,_ t:Double,_ box:CGRect){if t<1.36 {pet(c,"enter_"+action,t,box)}else if t<5.84{pet(c,action,t-1.36,box)}else{pet(c,"exit_"+action,t-5.84,box)}}
func shadow(_ c:CGContext,_ r:CGRect){c.saveGState();c.setShadow(offset:CGSize(width:0,height:16),blur:45,color:col(0x4B2358,0.10));fill(c,r,0xFFFFFF,28);c.restoreGState()}
func star(_ c:CGContext,_ x:CGFloat,_ y:CGFloat,_ r:CGFloat,_ hex:UInt32,_ alpha:CGFloat=1){let p=CGMutablePath();for i in 0..<8{let a=CGFloat(i)*CGFloat.pi/4-CGFloat.pi/2,rad=i%2==0 ? r:r*0.25;let q=CGPoint(x:x+cos(a)*rad,y:y+sin(a)*rad);if i==0{p.move(to:q)}else{p.addLine(to:q)}};p.closeSubpath();c.setFillColor(col(hex,alpha));c.addPath(p);c.fillPath()}
func cursor(_ c:CGContext,_ x:CGFloat,_ y:CGFloat,_ touch:Bool=false){c.saveGState();c.translateBy(x:x,y:y);let p=CGMutablePath();p.move(to:.zero);p.addLine(to:CGPoint(x:1,y:44));p.addLine(to:CGPoint(x:13,y:33));p.addLine(to:CGPoint(x:23,y:54));p.addLine(to:CGPoint(x:34,y:48));p.addLine(to:CGPoint(x:23,y:28));p.addLine(to:CGPoint(x:39,y:26));p.closeSubpath();c.addPath(p);c.setFillColor(col(ink));c.setStrokeColor(col(0xFFFFFF));c.setLineWidth(3);c.drawPath(using:.fillStroke);if touch{c.setStrokeColor(col(pink,0.6));c.setLineWidth(3);c.strokeEllipse(in:CGRect(x:-24,y:-24,width:48,height:48))};c.restoreGState()}
func bubble(_ c:CGContext,_ s:String,_ box:CGRect,_ user:Bool=false,_ font:CGFloat=30){shadow(c,box);if user{fill(c,box,0xF4E5EE,24)};txt(c,s,box.minX+26,box.minY+20,font,ink,false,box.width-52);let p=CGMutablePath();p.move(to:CGPoint(x:box.midX-14,y:box.maxY-1));p.addLine(to:CGPoint(x:box.midX+12,y:box.maxY+18));p.addLine(to:CGPoint(x:box.midX+20,y:box.maxY-1));c.setFillColor(col(user ? 0xF4E5EE:0xFFFFFF));c.addPath(p);c.fillPath()}
let starts:[Double]=[0,4,10,17.2,24.4,31.6,38.8,46,53.2,61.2]
let duration=67.2 // Original action sequence duration; film timeline is read from storyboard.json.
let labels=["让角色走进日常","桌面，就是她的新家","你忙你的，她陪着你","碰一下，就有回应","她也有自己的小日子","会走动，也会回到你身边","想说的话，随时说","安静的时候，也有人陪","把这份陪伴，分享出去","一起，让角色活过来"]
let titlesV=["让你喜欢的角色\n在桌面活过来","你的桌面\n多了一个她","你在认真生活\n她也一样","摸摸头\n她会回应你","读书、听歌、打游戏\n日子有声有色","她会到处走走\n也会向你跑来","今天发生的事\n都可以说给她听","什么都不做\n也可以一起待着","把你续写的故事\n分享给更多人","让你喜欢的角色\n在桌面活过来"]
let subtitles=["Demiurge · 开源角色陪伴", "坐在窗口边，陪你开始今天。", "工作、读书、写日记，各自忙碌，也彼此陪伴。", "拖一拖、轻轻摸头，看她的小表情。", "休息一下，再继续自己的小日常。", "四个方向，都有自己的姿态。", "按角色设定聊天，把相处留在记忆里。", "坐一会儿、趴一会儿，困了就睡一觉。", "分享角色、动作与生活，让更多相遇发生。", "给项目一颗 Star，和我们一起共建。"]
func bg(_ c:CGContext,_ w:CGFloat,_ h:CGFloat,_ t:Double,_ night:Bool=false){
 let cs=CGColorSpaceCreateDeviceRGB();let colors=[col(night ? 0x272139:0xFCF7FB),col(night ? 0x554461:0xEAE7FA)] as CFArray
 let g=CGGradient(colorsSpace:cs,colors:colors,locations:[0,1])!;c.drawLinearGradient(g,start:CGPoint(x:0,y:0),end:CGPoint(x:w,y:h),options:[])
 for i in 0..<16{let x=CGFloat((i*173+53)%1000)/1000*w,y=CGFloat((i*281+83)%1700)/1700*h;star(c,x,y,CGFloat(4+i%3*3),night ? 0xD8B9E0:0xC19DC5,0.25+0.12*CGFloat(sin(t*0.7+Double(i))))}
}
func window(_ c:CGContext,_ box:CGRect,_ t:Double,_ kind:String="notes"){
 shadow(c,box);fill(c,CGRect(x:box.minX,y:box.minY,width:box.width,height:56),0xF4EDF5,25);fill(c,CGRect(x:box.minX,y:box.minY+30,width:box.width,height:26),0xF4EDF5)
 for(i,color) in [UInt32(0xEBA1AF),0xEFC88B,0xAAD2BA].enumerated(){fill(c,CGRect(x:box.minX+22+CGFloat(i)*24,y:box.minY+22,width:12,height:12),color,6)}
 txt(c,kind=="notes" ? "今天的小计划" : "一段安静的工作时间",box.minX+120,box.minY+15,19,muted,false,box.width-140)
 let x=box.minX+35,y=box.minY+95
 txt(c,"把平凡的日常，",x,y,box.width>750 ? 39:31,ink,true,box.width-65);txt(c,"写成值得记住的片刻。",x,y+52,box.width>750 ? 39:31,ink,true,box.width-65)
 let lines=["整理今天的想法","完成手边的小事","记得喝水，也记得休息"]
 for(i,line) in lines.enumerated(){let ly=y+(box.height<450 ? 125:145)+CGFloat(i)*(box.height<450 ? 48:58);stroke(c,CGRect(x:x,y:ly+5,width:22,height:22),0xD4BED5,6,2);if i<Int(t/1.6){txt(c,"✓",x+3,ly-2,24,pink,true,24)};txt(c,line,x+38,ly,24,muted,false,box.width-100)}
 fill(c,CGRect(x:x,y:box.maxY-42,width:box.width-70,height:3),0xEFE7F2,2);fill(c,CGRect(x:x,y:box.maxY-42,width:(box.width-70)*min(0.92,CGFloat(t/10)),height:3),0xCB9EBE,2)
}
func header(_ c:CGContext,_ scene:Int,_ w:CGFloat,_ h:CGFloat,_ vertical:Bool,_ night:Bool){let light:UInt32=night ? 0xFFF4FA:ink;txt(c,"D E M I U R G E",vertical ? 76:90,vertical ? 108:58,vertical ? 29:25,light,true,600)
 let title=vertical ? titlesV[scene]:titlesV[scene];txt(c,title,vertical ? 76:90,vertical ? 235:178,vertical ? 76:69,light,true,vertical ? 930:760)
 txt(c,subtitles[scene],vertical ? 80:95,vertical ? 485:400,vertical ? 29:28,night ? 0xDCCDDD:muted,false,vertical ? 900:670)
 let fy=h-(vertical ? 165:100);txt(c,labels[scene],vertical ? 80:95,fy,vertical ? 28:25,night ? 0xEADCEB:muted,false,vertical ? 850:1400)
 fill(c,CGRect(x:vertical ? 80:95,y:h-(vertical ? 102:54),width:w-(vertical ? 160:190),height:3),night ? 0x685673:0xDCCDDD,2)
}
func montage(_ c:CGContext,_ acts:[String],_ names:[String],_ captions:[String],_ t:Double,_ vertical:Bool){
 for(i,a) in acts.enumerated(){let box=vertical ? CGRect(x:76,y:575+CGFloat(i)*342,width:928,height:310):CGRect(x:90+CGFloat(i)*590,y:470,width:560,height:440)
 shadow(c,box);if vertical{txt(c,names[i],box.minX+35,box.minY+82,43,ink,true,510);txt(c,captions[i],box.minX+37,box.minY+151,27,muted,false,470);routine(c,a,t,CGRect(x:box.maxX-355,y:box.minY-25,width:340,height:390))}else{txt(c,names[i],box.minX+28,box.minY+25,31,ink,true,500);routine(c,a,t,CGRect(x:box.minX+75,y:box.minY+56,width:410,height:390))}
 }
}
func renderBody(_ c:CGContext,_ t:Double,_ w:CGFloat,_ h:CGFloat){
 let v=h>w,scene=starts.lastIndex(where:{$0<=t}) ?? 0,l=t-starts[scene],night=scene==7
 bg(c,w,h,t,night);header(c,scene,w,h,v,night)
 switch scene {
 case 0:
  let box=v ? CGRect(x:130,y:610,width:820,height:1030):CGRect(x:1020,y:155,width:670,height:830)
  let a=l<0.9 ? "wave":(l>2.6&&l<2.96 ? "blink":"idle");pet(c,a,l<0.9 ? l:l-2.6,box)
  for i in 0..<5{star(c,box.midX+CGFloat(sin(Double(i)*2))*box.width*0.39,box.midY+CGFloat(cos(Double(i)*2))*box.height*0.32,CGFloat(12+i*3),0xC49BCE,0.7)}
  if l>1.0{bubble(c,"我来陪你啦。",v ? CGRect(x:530,y:590,width:390,height:92):CGRect(x:1370,y:170,width:370,height:88),false,30)}
  if !v{fill(c,CGRect(x:96,y:530,width:410,height:66),0xFFFFFF,33);txt(c,"角色 × 桌面 × 每一天",122,545,26,pink,true,380)}
 case 1:
  let wb=v ? CGRect(x:100,y:1000,width:880,height:500):CGRect(x:870,y:520,width:950,height:400);window(c,wb,l)
  let bx=wb.minX+wb.width*0.63,by=wb.minY-432
  if l<1.4{let x=wb.minX-190+ease(l/1.4)*(bx-wb.minX+190);pet(c,"walk_right",l,CGRect(x:x,y:by,width:390,height:560))}
  else if l<2.76{pet(c,"enter_sit",l-1.4,CGRect(x:bx,y:by,width:390,height:560))}
  else if l<4.64{pet(c,"sit",l-2.76,CGRect(x:bx,y:by,width:390,height:560))}
  else{pet(c,"exit_sit",l-4.64,CGRect(x:bx,y:by,width:390,height:560))}
  cursor(c,wb.minX+270+CGFloat(sin(l))*24,wb.minY+210)
 case 2:montage(c,["office","read","diary"],["你工作，她也工作","读到喜欢的那一页","把今天写进日记"],["一起专注，各自努力","安安静静地陪着你","平凡的小事，也值得记住"],l,v)
 case 3:
  let box=v ? CGRect(x:180,y:660,width:720,height:900):CGRect(x:1060,y:200,width:640,height:800)
  var action="drag",age=l
  if l>=1.4&&l<2.3{action="happy";age=l-1.4}else if l>=2.3&&l<3.05{action="nod";age=l-2.3}else if l>=3.05&&l<3.8{action="bounce";age=l-3.05}else if l>=3.8&&l<4.55{action="shake";age=l-3.8}else if l>=4.55&&l<5.4{action="thinking";age=l-4.55}else if l>=5.4&&l<6.25{action="sad";age=l-5.4}else if l>=6.25{action="surprised";age=l-6.25}
  var b=box;if l<1.4{b.origin.x += CGFloat(sin(l*2))*45;b.origin.y -= 40*ease(l/0.5)};pet(c,action,age,b)
  if l<3.05{cursor(c,b.midX+40+CGFloat(sin(l*7))*28,b.minY+b.height*0.18,l>=1.4)}
  let words=["drag":"轻轻拎起来","happy":"摸摸头，开心一点","nod":"嗯，听见啦","bounce":"忍不住开心一下","shake":"才不要呢","thinking":"让我想一想","sad":"也有低落的时候","surprised":"咦？"]
  bubble(c,words[action]!,v ? CGRect(x:235,y:590,width:610,height:96):CGRect(x:1100,y:135,width:590,height:94),false,31)
 case 4:montage(c,["gaming","music","snack"],["再玩一小局","把喜欢的歌循环","给自己一点甜"],["她也有自己的游戏时间","音乐响起，日常慢下来","吃点零食，恢复好心情"],l,v)
 case 5:
  let acts=["walk_left","walk_right","walk_up","walk_down"],ns=["向左走走","向右看看","去远处逛逛","回到你身边"]
  for i in 0..<4{let b=v ? CGRect(x:76+CGFloat(i%2)*476,y:570+CGFloat(i/2)*510,width:452,height:480):CGRect(x:850+CGFloat(i%2)*490,y:140+CGFloat(i/2)*400,width:465,height:380);shadow(c,b);txt(c,ns[i],b.minX+25,b.minY+22,v ? 30:27,ink,true,b.width-50);routine(c,acts[i],l,CGRect(x:b.minX+20,y:b.minY+30,width:b.width-40,height:b.height-25))}
 case 6:
  let b=v ? CGRect(x:230,y:810,width:660,height:820):CGRect(x:1050,y:310,width:620,height:700)
  if l<1.36{pet(c,"enter_listen",l,b)}else if l<3.5{pet(c,"listen",l-1.36,b)}else if l<5.84{pet(c,"talk",l-3.5,b)}else{pet(c,"exit_listen",l-5.84,b)}
  if l>0.3{bubble(c,"今天有点累。",v ? CGRect(x:440,y:575,width:520,height:95):CGRect(x:1320,y:140,width:460,height:90),true,31)}
  if l>2.0{bubble(c,"那就歇一会儿吧。\n我陪你，把今天慢慢说完。",v ? CGRect(x:115,y:715,width:790,height:145):CGRect(x:900,y:260,width:800,height:145),false,31)}
  txt(c,"演示对白 · 实际回复由所接入模型生成",v ? 150:950,v ? 1590:935,20,muted,false,850)
 case 7:
  for(i,a) in ["lie","sleep"].enumerated(){let b=v ? CGRect(x:80,y:580+CGFloat(i)*490,width:920,height:450):CGRect(x:860+CGFloat(i)*475,y:370,width:450,height:480);fill(c,b,0xFFFFFF,30,0.08);txt(c,i==0 ? "趴着发一会儿呆":"困了，就好好睡一觉",b.minX+30,b.minY+25,v ? 32:25,0xE9DDEC,true,b.width-50);routine(c,a,l,CGRect(x:b.minX+40,y:b.minY-15,width:b.width-80,height:b.height+70));if i==1&&l>1.36&&l<5.84{txt(c,"z  z  z",b.maxX-210,b.minY+90,28,0xD3C1E3,false,160)}}
 case 8:
  let img=l<4 ? communityShare:communityPlugins
  let b=v ? CGRect(x:65,y:610,width:950,height:680):CGRect(x:820,y:200,width:1040,height:640);shadow(c,b);fit(c,img,b.insetBy(dx:12,dy:12))
  let y=v ? 1370.0:870.0
  for(i,s) in ["分享角色包","发现桌宠","扩展生活习惯"].enumerated(){let bw:CGFloat=v ? 292:300;let x:CGFloat=v ? 80+CGFloat(i)*310:850+CGFloat(i)*325;fill(c,CGRect(x:x,y:y,width:bw,height:70),0xFFFFFF,35);txt(c,s,x,y+17,25,pink,true,bw,true)}
  if v{txt(c,"社区正在生长，\n欢迎带着你的作品加入。",95,1500,32,ink,true,890,true)}else{txt(c,"社区正在生长，等你一起共建。",95,540,32,pink,true,650)}
 case 9:
  let box=v ? CGRect(x:290,y:560,width:500,height:650):CGRect(x:1130,y:135,width:520,height:660);let phase=l.truncatingRemainder(dividingBy:3);pet(c,phase<0.84 ? "wave":(phase<1.05 ? "blink":(phase<2 ? "happy":"idle")),phase,box)
  let b=v ? CGRect(x:125,y:1220,width:830,height:150):CGRect(x:960,y:790,width:820,height:118);fill(c,b,pink,38);txt(c,"★  Star Demiurge",b.minX,b.minY+(v ? 35:24),v ? 52:45,0xFFFFFF,true,b.width,true)
  txt(c,"github.com/BubbleNNN/Demiurge",v ? 70:930,v ? 1425:940,v ? 35:33,ink,true,v ? 940:900,true)
  if v{txt(c,"分享桌宠 · 贡献动作 · 提出想法 · 参与开发",80,1530,28,muted,false,920,true)}else{txt(c,"分享桌宠 · 贡献动作\n提出想法 · 参与开发",95,535,34,pink,true,650)}
 default:break
 }
 // Quiet editorial fades between scenes; sprite poses retain their original timing.
 let end=scene<9 ? starts[scene+1]:duration
 let fadeIn=scene==0 ? 0:1-ease(l/0.18),fadeOut=scene==9 ? 0:ease((t-(end-0.16))/0.16)
 let a=max(fadeIn,fadeOut);if a>0{fill(c,CGRect(x:0,y:0,width:w,height:h),night ? 0x30263E:0xF9F4FB,0,a*0.88)}
 fill(c,CGRect(x:v ? 80:95,y:h-(v ? 102:54),width:(w-(v ? 160:190))*CGFloat(t/duration),height:3),night ? 0xDAB9D5:pink,2)
}

let board=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("scripts/media/storyboard.json"))) as! [String:Any]
let filmDuration=board["duration"] as! Double
let filmScenes=board["scenes"] as! [[String:Any]]
let openingURL=assets.appendingPathComponent("opening.mp4")
let openingGenerator:AVAssetImageGenerator? = FileManager.default.fileExists(atPath:openingURL.path) ? AVAssetImageGenerator(asset:AVURLAsset(url:openingURL)):nil
openingGenerator?.appliesPreferredTrackTransform=true
openingGenerator?.requestedTimeToleranceBefore = .zero
openingGenerator?.requestedTimeToleranceAfter = .zero
if mode == "video" || mode == "preview" {precondition(openingGenerator != nil,"Run prepare-opening.py with the official source before rendering the story film")}
func serif(_ c:CGContext,_ text:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ width:CGFloat,_ color:UInt32=0xF7E6F1,_ latin:Bool=false,_ spacing:CGFloat=0){
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:c,flipped:true)
 let p=NSMutableParagraphStyle();p.alignment = .center;p.lineSpacing=size*0.22
 let font=NSFont(name:latin ? "Baskerville":"Songti SC",size:size) ?? NSFont.systemFont(ofSize:size)
 (text as NSString).draw(in:CGRect(x:x,y:y,width:width,height:size*4),withAttributes:[.font:font,.foregroundColor:NSColor(cgColor:col(color))!,.paragraphStyle:p,.kern:spacing]);NSGraphicsContext.restoreGraphicsState()
}
func celestial(_ c:CGContext,_ w:CGFloat,_ h:CGFloat,_ t:Double){
 bg(c,w,h,t,true)
 let g=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:[col(0xDCA8D4,0.18),col(0x876DB8,0)] as CFArray,locations:[0,1])!
 c.drawRadialGradient(g,startCenter:CGPoint(x:w*0.52,y:h*0.43),startRadius:0,endCenter:CGPoint(x:w*0.52,y:h*0.43),endRadius:w*0.65,options:[])
 c.saveGState();c.translateBy(x:w*0.5,y:h*0.46);c.rotate(by:-0.38);c.setStrokeColor(col(0xDDB6CF,0.22));c.setLineWidth(1.2)
 for k in 0..<3{let a=w*(0.35+CGFloat(k)*0.045);c.strokeEllipse(in:CGRect(x:-a,y:-a*0.44,width:a*2,height:a*0.88))};c.restoreGState()
}
func filmFade(_ c:CGContext,_ t:Double,_ start:Double,_ end:Double,_ w:CGFloat,_ h:CGFloat,_ color:UInt32){
 let opacity=max(1-ease((t-start)/0.6),ease((t-(end-0.5))/0.5));if opacity>0{fill(c,CGRect(x:0,y:0,width:w,height:h),color,0,opacity)}
}
func render(_ c:CGContext,_ t:Double,_ w:CGFloat,_ h:CGFloat){
 let v=h>w
 let scene=filmScenes.last(where:{($0["start"] as! Double)<=t})!,id=scene["id"] as! String,start=scene["start"] as! Double,end=scene["end"] as! Double,l=t-start
 if t>=16.5 && t<65.7 {renderBody(c,t-12.5,w,h);return}
 if id=="memories" {
  celestial(c,w,h,t)
  if let gen=openingGenerator,let img=try? gen.copyCGImage(at:CMTime(seconds:min(t,7.466),preferredTimescale:600),actualTime:nil){
   // Preserve the complete official frame and its attribution; never stretch or crop it.
   let box=v ? CGRect(x:0,y:h*0.32,width:w,height:w*362/854):CGRect(x:210,y:170,width:w-420,height:(w-420)*362/854)
   fit(c,img,box)
  }
  serif(c,v ? "有些相遇，\n不该只留在回忆里。":"有些相遇，不该只留在回忆里。",v ? 65:150,v ? 1160:880,v ? 48:42,v ? w-130:w-300,0xEAD8E8)
  txt(c,"画面：《崩坏：星穹铁道》昔涟角色 PV「再度和你」",60,h-75,v ? 19:20,0xB8A7C2,false,w-120,true)
  filmFade(c,t,start,end,w,h,0x272139);return
 }
 if id=="promise" {
  celestial(c,w,h,t);serif(c,v ? "今天，\n我想续写她的故事。":"今天，我想续写她的故事。",55,h*0.42,v ? 65:72,w-110)
  filmFade(c,t,start,end,w,h,0x272139);return
 }
 if id=="brand" {
  celestial(c,w,h,t);star(c,w/2,h*(v ? 0.28:0.23),v ? 37:30,0xF0C4D8)
  c.saveGState();c.setAlpha(ease(l/1.2));serif(c,"德 谬 歌",40,h*(v ? 0.365:0.32),v ? 145:142,w-80,0xF9E9F0,false,8)
  serif(c,"DEMIURGE",40,h*(v ? 0.49:0.51),v ? 76:91,w-80,0xDBB8D0,true,v ? 12:23);c.restoreGState()
  let lineW=w*(v ? 0.65:0.36)*ease((l-0.35)/1.8);fill(c,CGRect(x:(w-lineW)/2,y:h*0.65,width:lineW,height:1.4),0xD1ABC8)
  txt(c,"让 喜 欢 的 角 色 ， 走 进 日 常",60,h*0.70,v ? 28:30,0xDCCBDD,false,w-120,true)
  filmFade(c,t,start,end,w,h,0x272139);return
 }
 if id=="new_story" || id=="i_can" {
  celestial(c,w,h,t)
  let words=scene["text"] as! String
  let display=(v && id=="new_story") ? words.replacingOccurrences(of:"角色",with:"角色\n"):words
  serif(c,display,60,h*(v && id=="new_story" ? 0.405:0.43),id=="i_can" ? (v ? 90:104):(v ? 72:81),w-120)
  filmFade(c,t,start,end,w,h,0x272139);return
 }
 if id=="create" {
  bg(c,w,h,t);txt(c,"D E M I U R G E",v ? 76:90,v ? 108:58,v ? 29:25,ink,true,700)
  serif(c,v ? "从一份喜欢开始\n让 ta 有更多模样":"从一份喜欢开始，让 ta 有更多模样",60,v ? 265:170,v ? 65:67,w-120,ink)
  txt(c,"收集设定与参考，自动生成不同画风的角色形象。",70,v ? 485:290,v ? 29:30,muted,false,w-140,true)
  let names=["认识 ta","选择画风","住进桌面"],small=["角色设定 · 原图参考","原作 · Q版 · 像素 · 低多边形","动作 · 互动 · 日常"]
  for i in 0..<3{let b=v ? CGRect(x:80,y:640+CGFloat(i)*285,width:w-160,height:245):CGRect(x:110+CGFloat(i)*580,y:435,width:540,height:390)
   shadow(c,b);txt(c,names[i],b.minX+32,b.minY+30,v ? 37:36,ink,true,b.width-64)
   txt(c,small[i],b.minX+32,b.minY+(v ? 97:105),v ? 26:25,muted,false,b.width-64)
   if i==0{let ref=load("reference.png");fit(c,ref,CGRect(x:b.maxX-(v ? 200:185),y:b.maxY-(v ? 220:230),width:170,height:210))}
   if i==1{for(j,label) in ["原作","Q版","像素","低多边形"].enumerated(){let bw:CGFloat=v ? 148:205,x=b.minX+28+CGFloat(j%(v ? 4:2))*(bw+14),y=b.minY+(v ? 165:180)+CGFloat(j/(v ? 4:2))*68;fill(c,CGRect(x:x,y:y,width:bw,height:52),j==1 ? 0xB45583:0xF3EAF4,18);txt(c,label,x,y+10,23,j==1 ? 0xFFFFFF:pink,true,bw,true)}}
   if i==2{pet(c,"read",l,CGRect(x:b.maxX-(v ? 240:280),y:b.maxY-(v ? 250:285),width:v ? 240:270,height:v ? 270:310))}
  }
  txt(c,"接入模型生成 · 核对形象与动作后启用",70,h-(v ? 230:120),v ? 26:24,muted,false,w-140,true)
  filmFade(c,t,start,end,w,h,0xF9F4FB);return
 }
 if id=="life" {
  bg(c,w,h,t);serif(c,v ? "让 ta 在桌面\n拥有自己的生活":"让 ta 在桌面，拥有自己的生活",55,v ? 250:150,v ? 70:70,w-110,ink)
  txt(c,"有喜欢做的事，也有与你共度的日常。",60,v ? 470:275,v ? 31:32,muted,false,w-120,true)
  let b=v ? CGRect(x:110,y:1020,width:860,height:500):CGRect(x:550,y:550,width:1200,height:420);window(c,b,l)
  pet(c,l<4 ? "diary":"music",l,v ? CGRect(x:370,y:610,width:560,height:630):CGRect(x:1080,y:220,width:540,height:620))
  txt(c,"懂得你的靠近，也保留自己的小小世界。",70,h-(v ? 230:75),v ? 29:29,pink,false,w-140,true)
  filmFade(c,t,start,end,w,h,0xF9F4FB);return
 }
 if id=="community" {renderBody(c,53.2+min(l,7.9),w,h);return}
 if id=="star" {renderBody(c,61.2+min(l,5.9),w,h);return}
 if id=="goodbye" {
  celestial(c,w,h,t)
  // Deliberately a separate closing page: no CTA, URL, counter or additional copy.
  serif(c,v ? "和你喜欢的角色，\n明天见":"和你喜欢的角色，明天见",60,h*(v ? 0.405:0.43),v ? 70:81,w-120)
  let fade=1-ease(l/1.1);if fade>0{fill(c,CGRect(x:0,y:0,width:w,height:h),0x272139,0,fade)};return
 }
}
func context(_ w:Int,_ h:Int)->CGContext{let c=CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!;c.translateBy(x:0,y:CGFloat(h));c.scaleBy(x:1,y:-1);return c}
func png(_ img:CGImage,_ url:URL){let d=CGImageDestinationCreateWithURL(url as CFURL,"public.png" as CFString,1,nil)!;CGImageDestinationAddImage(d,img,nil);precondition(CGImageDestinationFinalize(d))}
if mode=="preview" {
 for(v,w,h) in [(true,1080,1920),(false,1920,1080)]{for(i,t) in [1.2,4.0,6.2,9.5,14.2,19.5,25.5,32.5,40.0,47.0,54.5,62.0,67.8,71.9,78.0,87.5,95.0,102.0,109.0].enumerated(){let c=context(w,h);render(c,t,CGFloat(w),CGFloat(h));png(c.makeImage()!,assets.appendingPathComponent("preview-\(v ? "v":"h")-\(i).png"))}}
 print("Storyboard previews written")
} else if mode=="qa" {
 for page in 0..<4 {let indices=Array((page*54)..<min(frames.count,(page+1)*54));let c=context(1440,1800);fill(c,CGRect(x:0,y:0,width:1440,height:1800),0xF9F5FA);for(j,i) in indices.enumerated(){let x=CGFloat(j%6)*240,y=CGFloat(j/6)*200;petFrame(c,i,CGRect(x:x+30,y:y-5,width:180,height:190));txt(c,"\(i)",x+12,y+170,14,ink,false,100)};png(c.makeImage()!,assets.appendingPathComponent("frames-\(page).png"))};print("All 201 frames contact sheets written")
} else if mode=="video" {
 let vertical=CommandLine.arguments.count<5 || CommandLine.arguments[4]=="vertical",w=vertical ? 1080:1920,h=vertical ? 1920:1080
 let url=assets.appendingPathComponent(vertical ? "vertical-silent.mp4":"landscape-silent.mp4");try? FileManager.default.removeItem(at:url)
 let writer=try AVAssetWriter(outputURL:url,fileType:.mp4)
 let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:w,AVVideoHeightKey:h,AVVideoCompressionPropertiesKey:[AVVideoAverageBitRateKey:6000000,AVVideoProfileLevelKey:AVVideoProfileLevelH264HighAutoLevel,AVVideoMaxKeyFrameIntervalKey:60]])
 let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:w,kCVPixelBufferHeightKey as String:h,kCVPixelBufferCGImageCompatibilityKey as String:true,kCVPixelBufferCGBitmapContextCompatibilityKey as String:true])
 writer.add(input);writer.startWriting();writer.startSession(atSourceTime:.zero)
 for i in 0..<Int((filmDuration*30).rounded()){while !input.isReadyForMoreMediaData {Thread.sleep(forTimeInterval:0.002)};autoreleasepool{var b:CVPixelBuffer?;CVPixelBufferPoolCreatePixelBuffer(nil,adaptor.pixelBufferPool!,&b);let p=b!;CVPixelBufferLockBaseAddress(p,[]);let c=CGContext(data:CVPixelBufferGetBaseAddress(p),width:w,height:h,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(p),space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipFirst.rawValue)!;c.translateBy(x:0,y:CGFloat(h));c.scaleBy(x:1,y:-1);render(c,Double(i)/30,CGFloat(w),CGFloat(h));CVPixelBufferUnlockBaseAddress(p,[]);precondition(adaptor.append(p,withPresentationTime:CMTime(value:Int64(i),timescale:30)))};if i%300==0{print("Rendered \(i)/\(Int((filmDuration*30).rounded()))");fflush(stdout)}}
 input.markAsFinished();let done=DispatchSemaphore(value:0);writer.finishWriting{done.signal()};done.wait();precondition(writer.status == .completed,writer.error?.localizedDescription ?? "export failed");try JSONSerialization.data(withJSONObject:["duration":filmDuration,"width":w,"height":h,"fps":30,"usedClips":used.sorted()],options:.prettyPrinted).write(to:assets.appendingPathComponent("coverage-\(vertical ? "vertical":"landscape").json"));print("Video written: \(url.path)")
} else if mode=="gif" {
 for(name,start,seconds) in [("cyrene-chibi-work.gif",10.0,7.2),("cyrene-chibi-life.gif",24.4,7.2),("cyrene-chibi-desktop.gif",4.0,6.0),("cyrene-chibi-rest.gif",46.0,7.2)]{
 let count=Int(seconds*10),dst=CGImageDestinationCreateWithURL(output.appendingPathComponent(name) as CFURL,"com.compuserve.gif" as CFString,count,nil)!
 CGImageDestinationSetProperties(dst,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFLoopCount:0]] as CFDictionary)
 for i in 0..<count{autoreleasepool{let c=context(960,540);c.scaleBy(x:0.5,y:0.5);renderBody(c,start+Double(i)/10,1920,1080);CGImageDestinationAddImage(dst,c.makeImage()!,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFDelayTime:0.1]] as CFDictionary)}};precondition(CGImageDestinationFinalize(dst));print("GIF: \(name)")
 }
}
