export interface ReadmeFacts {
  /** The day it was made, YYYY-MM-DD. */
  day: string;
  standalone: boolean;
  /** The parts beside index.html: cut.js, film.json, modules/, assets/. */
  parts: readonly string[];
  assets: boolean;
  fonts: boolean;
  /** score.mid is in the folder. */
  midi?: boolean;
  /** Font families left out because no licence text could go with them. */
  fontsLeftOut: readonly string[];
  /** Files that could not be files of their own. */
  filesLeftOut: readonly string[];
}

const indent = (lines: readonly string[]): string => lines.map((line) => '    ' + line).join('\n');

/** README.txt: what each part of the folder is, and what to know before running it. */
export function sourceReadme(facts: ReadmeFacts): string {
  const sections: string[] = [`This folder is one video, as code. Made on ${facts.day}. An AI model wrote this code.`];
  if (facts.standalone)
    sections.push(
      'index.html\n' +
        indent([
          'Open it in a browser to watch the video. It needs no network.',
          'It is a built copy with everything it plays inside it' + (facts.fontsLeftOut.length > 0 ? ', except the fonts left out (see below)' : '') + ', so changing the other files does not change it.',
          'If someone else gave you this folder, trust it only as far as you trust them: they could have changed any file in it.',
          'If a window opens that asks you to pick a file, cancel it and close the tab: a video has no use for your files.',
        ]),
    );
  sections.push(
    facts.parts.join(', ') +
      '\n' +
      indent([
        'The same code' + (facts.assets ? ', pictures and clips' : '') + ' as separate files, laid out the way the agent works on a video.',
        'To look at the code, open it in a text editor. Don’t double-click these files: a browser runs an .html or .svg file opened that way without the limits that index.html puts on the code, and Windows by default runs a .js file as a program.',
      ]),
  );
  if (facts.midi === true)
    sections.push(
      'score.mid\n' +
        indent([
          'The video’s music and sound effects as a MIDI file, to open in a music app: a track for each instrument, with the drums and effects together on channel 10.',
          'Its tempo is the video’s, and a marker shows where the video starts.',
        ]),
    );
  if (facts.fonts)
    sections.push(
      'fonts/\n' +
        indent([
          'The typefaces the video uses, one folder for each family: its font files and its licence file. film.json says which files make up which family.',
          'Each family stays under its own licence. If you pass the font files on, with this folder or without it, keep each licence file with them.',
        ]),
    );
  if (facts.fontsLeftOut.length > 0)
    sections.push(
      'Fonts left out\n' +
        indent([
          facts.fontsLeftOut.join(', ') + ': no licence text could go with them, so their files are neither in this folder nor inside index.html.',
          'Their text shows in another font.',
        ]),
    );
  if (facts.filesLeftOut.length > 0)
    sections.push(
      'Not here as files of their own, because some computers cannot save a file under that name, the name does not fit what the file holds, or it could be mistaken for this folder’s index.html or README.txt: ' +
        facts.filesLeftOut.join(', ') +
        '.' +
        (facts.standalone ? '\nindex.html plays without them as files.' : ''),
    );
  return sections.join('\n\n') + '\n';
}
