//go:build app && darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

// WLAboutHandler 持有版本和版权，响应 About 菜单项。
// 使用 orderFrontStandardAboutPanelWithOptions: 直接传值，
// 不依赖 NSBundle 读取 Info.plist（CGo 环境下 mainBundle 可能读不到）。
@interface WLAboutHandler : NSObject
@property (nonatomic, copy) NSString *version;
@property (nonatomic, copy) NSString *copyright;
+ (instancetype)sharedWithVersion:(NSString *)v copyright:(NSString *)c;
- (void)showAbout:(id)sender;
@end

@implementation WLAboutHandler
+ (instancetype)sharedWithVersion:(NSString *)v copyright:(NSString *)c {
	static WLAboutHandler *inst;
	static dispatch_once_t once;
	dispatch_once(&once, ^{ inst = [[WLAboutHandler alloc] init]; });
	inst.version   = v;
	inst.copyright = c;
	return inst;
}
- (void)showAbout:(id)sender {
	// 自定义 About 窗口，完全控制外观，避免系统面板在深色模式下文字不可见
	NSWindow *win = [[NSWindow alloc]
		initWithContentRect:NSMakeRect(0, 0, 320, 220)
		          styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
		            backing:NSBackingStoreBuffered
		              defer:NO];
	win.title = @"";
	win.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
	win.releasedWhenClosed = NO;

	NSView *content = win.contentView;

	// 图标
	NSImageView *iconView = [[NSImageView alloc] initWithFrame:NSMakeRect(110, 140, 100, 60)];
	iconView.image = [NSApp applicationIconImage];
	iconView.imageScaling = NSImageScaleProportionallyUpOrDown;
	[content addSubview:iconView];

	// 应用名
	NSTextField *nameLabel = [[NSTextField alloc] initWithFrame:NSMakeRect(20, 108, 280, 28)];
	nameLabel.stringValue = @"WeLink";
	nameLabel.alignment = NSTextAlignmentCenter;
	nameLabel.font = [NSFont boldSystemFontOfSize:18];
	nameLabel.textColor = [NSColor labelColor];
	nameLabel.bezeled = NO;
	nameLabel.drawsBackground = NO;
	nameLabel.editable = NO;
	nameLabel.selectable = NO;
	[content addSubview:nameLabel];

	// 版本号
	NSTextField *verLabel = [[NSTextField alloc] initWithFrame:NSMakeRect(20, 80, 280, 22)];
	verLabel.stringValue = [NSString stringWithFormat:@"Version %@", self.version];
	verLabel.alignment = NSTextAlignmentCenter;
	verLabel.font = [NSFont systemFontOfSize:13];
	verLabel.textColor = [NSColor secondaryLabelColor];
	verLabel.bezeled = NO;
	verLabel.drawsBackground = NO;
	verLabel.editable = NO;
	verLabel.selectable = NO;
	[content addSubview:verLabel];

	// 版权
	NSTextField *copyLabel = [[NSTextField alloc] initWithFrame:NSMakeRect(20, 20, 280, 54)];
	copyLabel.stringValue = self.copyright;
	copyLabel.alignment = NSTextAlignmentCenter;
	copyLabel.font = [NSFont systemFontOfSize:11];
	copyLabel.textColor = [NSColor tertiaryLabelColor];
	copyLabel.bezeled = NO;
	copyLabel.drawsBackground = NO;
	copyLabel.editable = NO;
	copyLabel.selectable = NO;
	copyLabel.lineBreakMode = NSLineBreakByWordWrapping;
	[content addSubview:copyLabel];

	[win center];
	[win makeKeyAndOrderFront:nil];
}
@end

// setupAppMenu 为 NSApp 添加标准 Application / Edit / Window 菜单。
// webview_go 不会自动创建菜单，导致 Cmd+Q 等系统快捷键无法工作。
void setupAppMenu(const char *appName, const char *version, const char *copyright) {
	NSString *name = [NSString stringWithUTF8String:appName];
	NSString *ver  = [NSString stringWithUTF8String:version];
	NSString *copy = [NSString stringWithUTF8String:copyright];

	WLAboutHandler *aboutHandler = [WLAboutHandler sharedWithVersion:ver copyright:copy];

	NSMenu *menuBar = [[NSMenu alloc] init];
	[NSApp setMainMenu:menuBar];

	// ── Application 菜单 ──────────────────────────────────────────────────────
	NSMenuItem *appItem = [[NSMenuItem alloc] init];
	[menuBar addItem:appItem];
	NSMenu *appMenu = [[NSMenu alloc] initWithTitle:name];
	[appItem setSubmenu:appMenu];

	// About WeLink
	NSMenuItem *aboutItem = [[NSMenuItem alloc]
		initWithTitle:[@"About " stringByAppendingString:name]
		       action:@selector(showAbout:)
		keyEquivalent:@""];
	[aboutItem setTarget:aboutHandler];
	[appMenu addItem:aboutItem];

	[appMenu addItem:[NSMenuItem separatorItem]];

	// Hide（Cmd+H）
	[appMenu addItemWithTitle:[@"Hide " stringByAppendingString:name]
	                   action:@selector(hide:)
	            keyEquivalent:@"h"];

	// Hide Others（Cmd+Opt+H）
	NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"Hide Others"
	                                            action:@selector(hideOtherApplications:)
	                                     keyEquivalent:@"h"];
	[hideOthers setKeyEquivalentModifierMask:NSEventModifierFlagCommand | NSEventModifierFlagOption];

	// Show All
	[appMenu addItemWithTitle:@"Show All"
	                   action:@selector(unhideAllApplications:)
	            keyEquivalent:@""];

	[appMenu addItem:[NSMenuItem separatorItem]];

	// Quit（Cmd+Q）
	[appMenu addItemWithTitle:[@"Quit " stringByAppendingString:name]
	                   action:@selector(terminate:)
	            keyEquivalent:@"q"];

	// ── Edit 菜单 ─────────────────────────────────────────────────────────────
	NSMenuItem *editItem = [[NSMenuItem alloc] init];
	[menuBar addItem:editItem];
	NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
	[editItem setSubmenu:editMenu];
	[editMenu addItemWithTitle:@"Cut"        action:@selector(cut:)       keyEquivalent:@"x"];
	[editMenu addItemWithTitle:@"Copy"       action:@selector(copy:)      keyEquivalent:@"c"];
	[editMenu addItemWithTitle:@"Paste"      action:@selector(paste:)     keyEquivalent:@"v"];
	[editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];

	// ── Window 菜单 ───────────────────────────────────────────────────────────
	NSMenuItem *windowItem = [[NSMenuItem alloc] init];
	[menuBar addItem:windowItem];
	NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
	[windowItem setSubmenu:windowMenu];

	[windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
	[windowMenu addItemWithTitle:@"Zoom"     action:@selector(performZoom:)        keyEquivalent:@""];
	[windowMenu addItem:[NSMenuItem separatorItem]];

	NSMenuItem *fsItem = [windowMenu addItemWithTitle:@"Enter Full Screen"
	                                           action:@selector(toggleFullScreen:)
	                                    keyEquivalent:@"f"];
	[fsItem setKeyEquivalentModifierMask:NSEventModifierFlagCommand | NSEventModifierFlagControl];

	[NSApp setWindowsMenu:windowMenu];
}

// enableFullScreen 为主窗口开启全屏支持（需在 webview 窗口创建后调用）。
void enableFullScreen() {
	NSWindow *win = [NSApp mainWindow];
	if (!win) {
		win = [[NSApp windows] firstObject];
	}
	if (win) {
		[win setCollectionBehavior:[win collectionBehavior]
			| NSWindowCollectionBehaviorFullScreenPrimary];
	}
}
*/
import "C"

// appVersion 由 Makefile 通过 -ldflags "-X main.appVersion=x.y.z" 注入。
var appVersion = "dev"

func setupNativeMenu() {
	copyright := "Copyright © 2026 runzhliu.\nLicensed under AGPL-3.0."
	C.setupAppMenu(C.CString("WeLink"), C.CString(appVersion), C.CString(copyright))
}

func enableWindowFullScreen() {
	C.enableFullScreen()
}
