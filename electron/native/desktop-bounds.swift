// Desktop geometry for the desktop pet, without reading any window contents or titles:
// visible app windows (position, size, owning app), the frontmost app, and how many seconds ago
// the user last pressed a key or moved the pointer (timestamps only; no keystrokes are read).
// `desktop-bounds` prints one JSON snapshot; `desktop-bounds --watch 250` prints one per 250 ms
// until stdin closes or the parent process exits.
import AppKit
import CoreGraphics
import Foundation

// The order of each display's Spaces (desktops and full-screen apps) and which one is showing,
// from the window server, so the app can tell which way the user moved between Spaces.
@_silgen_name("CGSMainConnectionID") func CGSMainConnectionID() -> Int32
@_silgen_name("CGSCopyManagedDisplaySpaces") func CGSCopyManagedDisplaySpaces(_ connection: Int32) -> CFArray?
// Display UUID (as the window server names displays) to the display number apps use.
func displayNumbers() -> [String: UInt32] {
  var count: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &count)
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
  CGGetActiveDisplayList(count, &ids, &count)
  var result: [String: UInt32] = [:]
  for id in ids {
    if let uuid = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue(),
      let text = CFUUIDCreateString(nil, uuid) as String?
    {
      result[text.uppercased()] = id
    }
  }
  return result
}
func spaces() -> [[String: Any]] {
  guard let displays = CGSCopyManagedDisplaySpaces(CGSMainConnectionID()) as? [[String: Any]] else { return [] }
  let numbers = displayNumbers()
  let main = CGMainDisplayID()
  return displays.compactMap { display in
    guard let current = display["Current Space"] as? [String: Any],
      let id = current["ManagedSpaceID"] as? Int,
      let list = display["Spaces"] as? [[String: Any]],
      let index = list.firstIndex(where: { ($0["ManagedSpaceID"] as? Int) == id })
    else { return nil }
    let name = (display["Display Identifier"] as? String ?? "").uppercased()
    // A single display may be named "Main" instead of by its UUID.
    let number = numbers[name] ?? (name == "MAIN" ? main : 0)
    return ["display": number, "space": id, "index": index]
  }
}

var bundles: [pid_t: String] = [:]
func bundle(_ pid: pid_t) -> String {
  if let known = bundles[pid] { return known }
  let value = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
  bundles[pid] = value
  return value
}

func snapshot() -> [String: Any] {
  let list =
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  let windows = list.compactMap { w -> [String: Any]? in
    guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
      let b = w[kCGWindowBounds as String] as? [String: Any],
      let id = w[kCGWindowNumber as String],
      let pid = w[kCGWindowOwnerPID as String] as? Int32
    else { return nil }
    return [
      "id": id, "pid": pid, "bounds": b,
      "alpha": w[kCGWindowAlpha as String] as? Double ?? 1,
      "owner": w[kCGWindowOwnerName as String] as? String ?? "",
      "bundle": bundle(pid),
    ]
  }
  let front = NSWorkspace.shared.frontmostApplication
  return [
    "spaces": spaces(),
    "windows": windows,
    "front": [
      "pid": front?.processIdentifier ?? 0,
      "bundle": front?.bundleIdentifier ?? "",
      "name": front?.localizedName ?? "",
    ],
    "keyIdle": CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown),
    "pointerIdle": min(
      CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .mouseMoved),
      CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .leftMouseDown),
      CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .scrollWheel)),
  ]
}

func emit() {
  guard let data = try? JSONSerialization.data(withJSONObject: snapshot()),
    let line = String(data: data, encoding: .utf8)
  else { return }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

let args = CommandLine.arguments
if let at = args.firstIndex(of: "--watch") {
  let ms = at + 1 < args.count ? max(100, Int(args[at + 1]) ?? 250) : 250
  let parent = getppid()
  // Stop when the app goes away: stdin closes, or this process is re-parented.
  FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty { exit(0) }
  }
  while true {
    if getppid() != parent { exit(0) }
    emit()
    // Running the loop between snapshots keeps the frontmost-app information current.
    RunLoop.current.run(until: Date(timeIntervalSinceNow: Double(ms) / 1000))
  }
} else {
  emit()
}
