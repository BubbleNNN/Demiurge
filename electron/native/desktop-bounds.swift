import Foundation
import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
let result = list.compactMap { w -> [String:Any]? in
 guard let layer=w[kCGWindowLayer as String] as? Int,layer==0,let b=w[kCGWindowBounds as String] as? [String:Any],let id=w[kCGWindowNumber as String],let pid=w[kCGWindowOwnerPID as String] else{return nil}
 return ["id":id,"pid":pid,"bounds":b]
}
let data=try JSONSerialization.data(withJSONObject:result)
print(String(data:data,encoding:.utf8)!)
