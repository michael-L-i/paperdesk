// Executed by macOS's JavaScript for Automation runtime, not Node.
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  const panel = $.NSOpenPanel.openPanel;
  panel.canChooseDirectories = true;
  panel.canChooseFiles = false;
  panel.allowsMultipleSelection = false;
  panel.canCreateDirectories = true;
  panel.title = 'Open directory';
  panel.prompt = 'Open';
  if (argv[0]) panel.directoryURL = $.NSURL.fileURLWithPath(argv[0]);
  app.activateIgnoringOtherApps(true);
  if (panel.runModal !== $.NSModalResponseOK) return JSON.stringify({ cancelled: true });
  return JSON.stringify({ path: ObjC.unwrap(panel.URL.path) });
}
