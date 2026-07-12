import AppKit

private struct AlertOptions {
    let level: String
    let title: String
    let message: String
    let duration: TimeInterval
    let isChinese: Bool

    static func parse(_ arguments: [String]) -> AlertOptions? {
        var values: [String: String] = [:]
        var index = 1
        while index + 1 < arguments.count {
            if arguments[index].hasPrefix("--") {
                values[arguments[index]] = arguments[index + 1]
                index += 2
            } else {
                index += 1
            }
        }
        let isChinese = (Locale.preferredLanguages.first ?? "en")
            .lowercased().hasPrefix("zh")
        let titleKey = isChinese ? "--title-zh" : "--title-en"
        let messageKey = isChinese ? "--message-zh" : "--message-en"
        guard let title = values[titleKey],
              let message = values[messageKey],
              let durationText = values["--duration"],
              let duration = TimeInterval(durationText), duration >= 0 else {
            return nil
        }
        return AlertOptions(
            level: values["--level"] ?? "ok",
            title: title,
            message: message,
            duration: duration,
            isChinese: isChinese
        )
    }
}

@MainActor
private final class AlertController: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let options: AlertOptions
    private var panel: NSPanel?
    private var timer: Timer?

    init(options: AlertOptions) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 168),
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.delegate = self
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true

        let background = NSVisualEffectView()
        background.material = .hudWindow
        background.blendingMode = .behindWindow
        background.state = .active
        background.wantsLayer = true
        background.layer?.cornerRadius = 14
        background.layer?.borderWidth = 2
        background.layer?.borderColor = accentColor.cgColor
        panel.contentView = background

        let title = NSTextField(labelWithString: options.title)
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.textColor = accentColor

        let message = NSTextField(wrappingLabelWithString: options.message)
        message.font = .systemFont(ofSize: 13)
        message.maximumNumberOfLines = 3
        message.lineBreakMode = .byWordWrapping

        let timing = NSTextField(labelWithString: options.duration > 0
            ? (options.isChinese
                ? "\(Int(options.duration)) 秒后自动关闭"
                : "Closes automatically in \(Int(options.duration)) seconds")
            : (options.isChinese
                ? "请手动关闭此紧急提醒"
                : "Please dismiss this critical alert manually"))
        timing.font = .systemFont(ofSize: 11)
        timing.textColor = .secondaryLabelColor

        let closeButton = NSButton(
            title: options.isChinese ? "关闭" : "Dismiss",
            target: self,
            action: #selector(closeAlert)
        )
        closeButton.bezelStyle = .rounded
        closeButton.keyEquivalent = "\u{1b}"

        for view in [title, message, timing, closeButton] {
            view.translatesAutoresizingMaskIntoConstraints = false
            background.addSubview(view)
        }

        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: background.leadingAnchor, constant: 22),
            title.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -16),
            title.topAnchor.constraint(equalTo: background.topAnchor, constant: 27),

            closeButton.trailingAnchor.constraint(equalTo: background.trailingAnchor, constant: -20),
            closeButton.centerYAnchor.constraint(equalTo: title.centerYAnchor),

            message.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            message.trailingAnchor.constraint(equalTo: background.trailingAnchor, constant: -22),
            message.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 13),

            timing.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            timing.bottomAnchor.constraint(equalTo: background.bottomAnchor, constant: -19),
        ])

        if let screen = NSScreen.main ?? NSScreen.screens.first {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(
                x: frame.maxX - panel.frame.width - 24,
                y: frame.maxY - panel.frame.height - 24
            ))
        } else {
            panel.center()
        }

        self.panel = panel
        panel.orderFrontRegardless()

        if options.duration > 0 {
            timer = Timer.scheduledTimer(withTimeInterval: options.duration, repeats: false) { _ in
                Task { @MainActor in self.closeAlert() }
            }
        }
    }

    private var accentColor: NSColor {
        switch options.level {
        case "critical": return .systemRed
        case "severe": return .systemOrange
        default: return .systemBlue
        }
    }

    @objc private func closeAlert() {
        timer?.invalidate()
        panel?.close()
        NSApplication.shared.terminate(nil)
    }

    func windowWillClose(_ notification: Notification) {
        timer?.invalidate()
        NSApplication.shared.terminate(nil)
    }
}

guard let options = AlertOptions.parse(CommandLine.arguments) else {
    FileHandle.standardError.write(Data("invalid alert arguments\n".utf8))
    exit(2)
}

let application = NSApplication.shared
let controller = AlertController(options: options)
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()
