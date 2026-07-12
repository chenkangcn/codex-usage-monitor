#import <AppKit/AppKit.h>

@interface AlertController : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(nonatomic, strong) NSDictionary<NSString *, NSString *> *options;
@property(nonatomic, strong) NSPanel *panel;
@property(nonatomic, strong) NSTimer *timer;
@end

@implementation AlertController

- (instancetype)initWithOptions:(NSDictionary<NSString *, NSString *> *)options {
    self = [super init];
    if (self) _options = options;
    return self;
}

- (NSColor *)accentColor {
    NSString *level = self.options[@"--level"];
    if ([level isEqualToString:@"critical"]) return NSColor.systemRedColor;
    if ([level isEqualToString:@"severe"]) return NSColor.systemOrangeColor;
    return NSColor.systemBlueColor;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSString *preferredLanguage = NSLocale.preferredLanguages.firstObject ?: @"en";
    BOOL isChinese = [preferredLanguage.lowercaseString hasPrefix:@"zh"];
    NSString *titleText = self.options[isChinese ? @"--title-zh" : @"--title-en"];
    NSString *messageText = self.options[isChinese ? @"--message-zh" : @"--message-en"];
    NSRect rect = NSMakeRect(0, 0, 420, 168);
    self.panel = [[NSPanel alloc] initWithContentRect:rect
                                            styleMask:NSWindowStyleMaskTitled |
                                                      NSWindowStyleMaskClosable |
                                                      NSWindowStyleMaskFullSizeContentView |
                                                      NSWindowStyleMaskNonactivatingPanel
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
    self.panel.titleVisibility = NSWindowTitleHidden;
    self.panel.titlebarAppearsTransparent = YES;
    self.panel.movableByWindowBackground = YES;
    self.panel.releasedWhenClosed = NO;
    self.panel.hidesOnDeactivate = NO;
    self.panel.level = NSFloatingWindowLevel;
    self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                    NSWindowCollectionBehaviorFullScreenAuxiliary;
    self.panel.delegate = self;
    [self.panel standardWindowButton:NSWindowMiniaturizeButton].hidden = YES;
    [self.panel standardWindowButton:NSWindowZoomButton].hidden = YES;

    NSVisualEffectView *background = [[NSVisualEffectView alloc] initWithFrame:rect];
    background.material = NSVisualEffectMaterialHUDWindow;
    background.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    background.state = NSVisualEffectStateActive;
    background.wantsLayer = YES;
    background.layer.cornerRadius = 14;
    background.layer.borderWidth = 2;
    background.layer.borderColor = self.accentColor.CGColor;
    self.panel.contentView = background;

    NSTextField *title = [NSTextField labelWithString:titleText];
    title.font = [NSFont systemFontOfSize:17 weight:NSFontWeightSemibold];
    title.textColor = self.accentColor;

    NSTextField *message = [NSTextField wrappingLabelWithString:messageText];
    message.font = [NSFont systemFontOfSize:13];
    message.maximumNumberOfLines = 3;
    message.lineBreakMode = NSLineBreakByWordWrapping;

    NSTimeInterval duration = [self.options[@"--duration"] doubleValue];
    NSString *timingText;
    if (duration > 0) {
        timingText = isChinese
            ? [NSString stringWithFormat:@"%ld 秒后自动关闭", (long)duration]
            : [NSString stringWithFormat:@"Closes automatically in %ld seconds", (long)duration];
    } else {
        timingText = isChinese
            ? @"请手动关闭此紧急提醒"
            : @"Please dismiss this critical alert manually";
    }
    NSTextField *timing = [NSTextField labelWithString:timingText];
    timing.font = [NSFont systemFontOfSize:11];
    timing.textColor = NSColor.secondaryLabelColor;

    NSButton *closeButton = [NSButton buttonWithTitle:(isChinese ? @"关闭" : @"Dismiss")
                                               target:self
                                               action:@selector(closeAlert:)];
    closeButton.bezelStyle = NSBezelStyleRounded;
    closeButton.keyEquivalent = @"\033";

    for (NSView *view in @[title, message, timing, closeButton]) {
        view.translatesAutoresizingMaskIntoConstraints = NO;
        [background addSubview:view];
    }
    [NSLayoutConstraint activateConstraints:@[
        [title.leadingAnchor constraintEqualToAnchor:background.leadingAnchor constant:22],
        [title.trailingAnchor constraintLessThanOrEqualToAnchor:closeButton.leadingAnchor constant:-16],
        [title.topAnchor constraintEqualToAnchor:background.topAnchor constant:27],
        [closeButton.trailingAnchor constraintEqualToAnchor:background.trailingAnchor constant:-20],
        [closeButton.centerYAnchor constraintEqualToAnchor:title.centerYAnchor],
        [message.leadingAnchor constraintEqualToAnchor:title.leadingAnchor],
        [message.trailingAnchor constraintEqualToAnchor:background.trailingAnchor constant:-22],
        [message.topAnchor constraintEqualToAnchor:title.bottomAnchor constant:13],
        [timing.leadingAnchor constraintEqualToAnchor:title.leadingAnchor],
        [timing.bottomAnchor constraintEqualToAnchor:background.bottomAnchor constant:-19],
    ]];

    NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    if (screen) {
        NSRect frame = screen.visibleFrame;
        [self.panel setFrameOrigin:NSMakePoint(
            NSMaxX(frame) - NSWidth(self.panel.frame) - 24,
            NSMaxY(frame) - NSHeight(self.panel.frame) - 24
        )];
    } else {
        [self.panel center];
    }
    [self.panel orderFrontRegardless];

    if (duration > 0) {
        self.timer = [NSTimer scheduledTimerWithTimeInterval:duration
                                                     target:self
                                                   selector:@selector(closeAlert:)
                                                   userInfo:nil
                                                    repeats:NO];
    }
}

- (void)closeAlert:(id)sender {
    [self.timer invalidate];
    [self.panel close];
    [NSApp terminate:nil];
}

- (void)windowWillClose:(NSNotification *)notification {
    [self.timer invalidate];
    [NSApp terminate:nil];
}

@end

static NSDictionary<NSString *, NSString *> *ParseOptions(int argc, const char *argv[]) {
    NSMutableDictionary *values = [NSMutableDictionary dictionary];
    for (int index = 1; index + 1 < argc; index += 2) {
        NSString *key = [NSString stringWithUTF8String:argv[index]];
        NSString *value = [NSString stringWithUTF8String:argv[index + 1]];
        if ([key hasPrefix:@"--"] && value) values[key] = value;
    }
    if (!values[@"--title-zh"] || !values[@"--message-zh"] ||
        !values[@"--title-en"] || !values[@"--message-en"] ||
        !values[@"--duration"]) return nil;
    return values;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSDictionary *options = ParseOptions(argc, argv);
        if (!options) {
            fprintf(stderr, "invalid alert arguments\n");
            return 2;
        }
        NSApplication *application = NSApplication.sharedApplication;
        AlertController *controller = [[AlertController alloc] initWithOptions:options];
        [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        application.delegate = controller;
        [application run];
    }
    return 0;
}
