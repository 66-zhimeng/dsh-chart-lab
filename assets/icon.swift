// Render the chart-lab storefront icon: 512px rounded tile with bars and a trend.
// usage: swift icon.swift <out.png>
import AppKit

let size = 512.0
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
rep.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
let g = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = g
g.cgContext.setShouldAntialias(true)

func rgb(_ r: Int, _ g: Int, _ b: Int, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: a)
}

// Tile
let tile = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size), xRadius: 112, yRadius: 112)
rgb(15, 27, 45).setFill()
tile.fill()

// Keep every later shape inside the tile.
tile.addClip()

// Baseline grid
let grid = NSBezierPath()
grid.lineWidth = 3
for step in 0..<4 {
    let y = 140.0 + Double(step) * 66
    grid.move(to: NSPoint(x: 84, y: y))
    grid.line(to: NSPoint(x: 428, y: y))
}
rgb(255, 255, 255, 0.07).setStroke()
grid.stroke()

// Bars
let bars: [(Double, NSColor)] = [
    (120, rgb(91, 143, 249)),
    (176, rgb(97, 221, 170)),
    (132, rgb(246, 189, 22)),
    (232, rgb(255, 159, 67)),
]
let barWidth = 62.0
let gap = 26.0
let base = 128.0
var x = 96.0
for (height, colour) in bars {
    let rect = NSRect(x: x, y: base, width: barWidth, height: height)
    let path = NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14)
    colour.setFill()
    path.fill()
    x += barWidth + gap
}

// Datum markers on the bar tops: a quiet trend, not a second graph.
var tops: [NSPoint] = []
var cursor = 96.0 + barWidth / 2
for (height, _) in bars {
    tops.append(NSPoint(x: cursor, y: base + height))
    cursor += barWidth + gap
}
let trend = NSBezierPath()
trend.move(to: tops[0])
for point in tops.dropFirst() {
    trend.line(to: point)
}
trend.lineWidth = 9
trend.lineJoinStyle = .round
trend.lineCapStyle = .round
rgb(255, 255, 255, 0.7).setStroke()
trend.stroke()
// One terminal marker: the line is the trend, the dot is the latest point.
if let last = tops.last {
    let ring = NSBezierPath(ovalIn: NSRect(x: last.x - 19, y: last.y - 19, width: 38, height: 38))
    rgb(255, 159, 67).setFill()
    ring.fill()
    let hole = NSBezierPath(ovalIn: NSRect(x: last.x - 12, y: last.y - 12, width: 24, height: 24))
    rgb(15, 27, 45).setFill()
    hole.fill()
}

// Axis
let axis = NSBezierPath()
axis.move(to: NSPoint(x: 84, y: 122))
axis.line(to: NSPoint(x: 428, y: 122))
axis.lineWidth = 6
axis.lineCapStyle = .round
rgb(255, 255, 255, 0.35).setStroke()
axis.stroke()

NSGraphicsContext.restoreGraphicsState()
let data = rep.representation(using: .png, properties: [:])!
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
