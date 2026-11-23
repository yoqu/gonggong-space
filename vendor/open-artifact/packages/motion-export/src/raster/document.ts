/** A script's text made safe to sit inside a <script> element. */
export function inScript(text: string): string {
  return text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!-{2}/g, '<\\x21--');
}

/** The raster frame can run its own script and read data: pictures, and nothing else. */
export const RASTER_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

/** A picture made only of a foreignObject: drawing it first shows whether this browser can draw snapshots at all. */
export const FOREIGN_OBJECT_TEST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><foreignObject width="2" height="2"><div xmlns="http://www.w3.org/1999/xhtml" style="width:2px;height:2px;background:#000"></div></foreignObject></svg>';

export function rasterDocument(script: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    RASTER_CONTENT_SECURITY_POLICY +
    '"></head><body><script>' +
    inScript(script) +
    '</script></body></html>'
  );
}
