// Render a local HTML file to PNG with an offscreen WKWebView.
// usage: swift snapshot.swift <in.html> <out.png> [width] [height] [scale]
import Cocoa
import WebKit

final class Snapshotter: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let output: URL
    let scale: CGFloat
    let window: NSWindow

    init(file: URL, output: URL, width: CGFloat, height: CGFloat, scale: CGFloat) {
        self.output = output
        self.scale = scale
        let frame = NSRect(x: 0, y: 0, width: width, height: height)
        webView = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        window.contentView = webView
        window.orderFrontRegardless()
        webView.navigationDelegate = self
        webView.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
            FileHandle.standardError.write("timeout\n".data(using: .utf8)!)
            exit(3)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            let config = WKSnapshotConfiguration()
            config.rect = self.webView.bounds
            config.snapshotWidth = NSNumber(value: Double(self.webView.bounds.width * self.scale))
            self.webView.takeSnapshot(with: config) { image, error in
                guard error == nil,
                      let image = image,
                      let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    FileHandle.standardError.write("snapshot failed\n".data(using: .utf8)!)
                    exit(1)
                }
                do { try png.write(to: self.output) } catch {
                    FileHandle.standardError.write("write failed\n".data(using: .utf8)!)
                    exit(1)
                }
                exit(0)
            }
        }
    }
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: snapshot.swift <in.html> <out.png> [width] [height] [scale]\n".data(using: .utf8)!)
    exit(2)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
let width = CGFloat(Double(args.count > 3 ? args[3] : "1160") ?? 1160)
let height = CGFloat(Double(args.count > 4 ? args[4] : "700") ?? 700)
let scale = CGFloat(Double(args.count > 5 ? args[5] : "2") ?? 2)

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let snapshotter = Snapshotter(file: input, output: output, width: width, height: height, scale: scale)
withExtendedLifetime(snapshotter) {
    app.run()
}
