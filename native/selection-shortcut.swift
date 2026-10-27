import AppKit
import ApplicationServices

// Observe Command+C without swallowing normal copy events.
var firstPress: TimeInterval = 0
var pressed = false
var busy = false
var activationCount = 0
var tap: CFMachPort?
func emit(_ value: [String: String]) {
    if let data = try? JSONSerialization.data(withJSONObject: value),
       let text = String(data: data, encoding: .utf8) {
        print(text)
        fflush(stdout)
    }
}
func selectedText(_ pid: pid_t) -> String? {
    let system = AXUIElementCreateApplication(pid)
    var focused: CFTypeRef?
    guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
          let focused = focused else { return nil }
    var value: CFTypeRef?
    let element = focused as! AXUIElement
    guard AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &value) == .success,
          let text = value as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return text
}
func finish(_ text: String?) {
    busy = false
    if let text = text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        emit(["type": "selection", "text": text])
    } else {
        emit(["type": "error", "message": "Select copyable text, then hold Command and press C twice."])
    }
}
func copySelection(_ pid: pid_t) {
    let board = NSPasteboard.general
    // Save all clipboard formats; never translate old clipboard contents.
    let saved = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
        let copy = NSPasteboardItem()
        for type in item.types {
            if let data = item.data(forType: type) { copy.setData(data, forType: type) }
        }
        return copy
    }
    let before = board.changeCount
    let source = CGEventSource(stateID: .privateState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: 8, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: 8, keyDown: false)
    down?.setIntegerValueField(.eventSourceUserData, value: 0x54524E53)
    up?.setIntegerValueField(.eventSourceUserData, value: 0x54524E53)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.postToPid(pid)
    up?.postToPid(pid)
    var attempts = 0
    Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { timer in
        attempts += 1
        if board.changeCount != before {
            let text = board.string(forType: .string)
            board.clearContents()
            if !saved.isEmpty { board.writeObjects(saved) }
            timer.invalidate()
            finish(text)
        } else if attempts >= 16 {
            timer.invalidate()
            finish(nil)
        }
    }
}
func captureSelection(_ eventPid: pid_t) {
    guard !busy else { return }
    busy = true
    let originalApp = eventPid > 0 ? eventPid : (NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
    if let text = selectedText(originalApp) { finish(text); return }
    var attempts = 0
    // Let Command go before synthesizing the normal macOS Copy command.
    Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { timer in
        attempts += 1
        let flags = CGEventSource.flagsState(.combinedSessionState)
        if !flags.contains(.maskCommand) {
            timer.invalidate(); copySelection(originalApp)
        } else if attempts >= 100 {
            timer.invalidate(); finish(nil)
        }
    }
}
let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
        firstPress = 0; pressed = false
        return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == 0x54524E53 { return Unmanaged.passUnretained(event) }
    let isC = event.getIntegerValueField(.keyboardEventKeycode) == 8
    if type == .keyUp && isC && pressed {
        pressed = false
        return Unmanaged.passUnretained(event)
    }
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }
    let flags = event.flags
    let chord = isC && flags.contains(.maskCommand) && !flags.contains(.maskControl)
        && !flags.contains(.maskAlternate) && !flags.contains(.maskShift)
    guard chord else {
        firstPress = 0
        return Unmanaged.passUnretained(event)
    }
    if pressed || event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return Unmanaged.passUnretained(event) }
    pressed = true
    let now = ProcessInfo.processInfo.systemUptime
    let elapsed = now - firstPress
    if firstPress > 0 && elapsed >= 0.05 && elapsed <= 1.0 {
        firstPress = 0
        activationCount += 1
        if !CommandLine.arguments.contains("--self-test") {
            let pid = pid_t(event.getIntegerValueField(.eventTargetUnixProcessID))
            DispatchQueue.main.async { captureSelection(pid) }
        }
    } else { firstPress = now }
    return Unmanaged.passUnretained(event)
}
if CommandLine.arguments.contains("--self-test") {
    func event(_ down: Bool, _ flags: CGEventFlags = .maskCommand, _ repeatKey: Bool = false) -> CGEvent {
        let e = CGEvent(keyboardEventSource: nil, virtualKey: 8, keyDown: down)!
        e.flags = flags
        e.setIntegerValueField(.keyboardEventAutorepeat, value: repeatKey ? 1 : 0)
        return e
    }
    let proxy = OpaquePointer(bitPattern: 1)!
    precondition(callback(proxy, .keyDown, event(true, .maskControl), nil) != nil)
    precondition(activationCount == 0)
    precondition(callback(proxy, .keyDown, event(true), nil) != nil)
    _ = callback(proxy, .keyDown, event(true, .maskCommand, true), nil)
    precondition(activationCount == 0)
    _ = callback(proxy, .keyUp, event(false), nil)
    firstPress = ProcessInfo.processInfo.systemUptime - 0.2
    _ = callback(proxy, .keyDown, event(true), nil)
    precondition(activationCount == 1)
    _ = callback(proxy, .keyUp, event(false), nil)
    firstPress = ProcessInfo.processInfo.systemUptime - 2
    _ = callback(proxy, .keyDown, event(true), nil)
    precondition(activationCount == 1)
    _ = callback(proxy, .keyUp, event(false), nil)
    precondition(callback(proxy, .keyDown, event(true, [.maskCommand, .maskShift]), nil) != nil)
    precondition(firstPress == 0)
    print("PASS: Cmd+C+C, single copy preserved, Ctrl+C ignored, repeats ignored, timeout, extra modifiers")
    exit(0)
}
let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
tap = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .headInsertEventTap,
                       options: .defaultTap, eventsOfInterest: CGEventMask(mask),
                       callback: callback, userInfo: nil)
guard let activeTap = tap else {
    emit(["type": "permission", "message": "Allow Accessibility access for CC Translate to use Cmd+C+C."])
    exit(1)
}
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, activeTap, 0)
CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
CGEvent.tapEnable(tap: activeTap, enable: true)
emit(["type": "ready"])
CFRunLoopRun()
