// Song packs. Each beat = one photo/pose; `caption` is the handwritten line under that photo on the strip. Times are seconds relative to `segment.start` in the audio file.
// To add a song later: copy this object, change src/segment/beats, and point beats at pose ids from poses.js.

export const SONGS = {
  'last-christmas': {
    id: 'last-christmas',
    title: 'Last Christmas',
    artist: 'Wham!',
    src: 'assets/songs/last-christmas.mp3',
    // "Once" is sung at 70.90 s in this mp3. Measured with whisper word timestamps + a vocal-band onset scan
    // (centre-channel energy jumps when the vocal enters). Line times below are offsets from that point.
    segment: { start: 70.9, fadeIn: 0.25, fadeOut: 2.2 },
    beats: [
      { pose: 'bite',     caption: 'once bitten',   lines: [{ t: 0.0, text: 'Once bitten' }] },
      { pose: 'hide',     caption: 'twice shy',     lines: [{ t: 2.25, text: 'and twice shy' }] },
      { pose: 'distance', caption: 'i keep my distance', lines: [{ t: 4.82, text: 'I keep my distance' }] },
      { pose: 'eye',      caption: 'you still catch my eye', lines: [{ t: 7.15, text: 'but you still catch my eye' }] },
      { pose: 'point',    caption: 'do you recognize me', lines: [{ t: 10.08, text: 'Tell me, baby' }, { t: 11.63, text: 'do you recognize me?' }] },
      { pose: 'shrug',    caption: "it doesn't surprise me", lines: [{ t: 14.0, text: "Well, it's been a year" }, { t: 16.35, text: "it doesn't surprise me" }] },
    ],
    end: 18.3, // "surprise me" ends; "Happy Christmas" follows
  },
};

export const DEFAULT_SONG = 'last-christmas';

// Beats used for a layout: 4-frame layouts take the first four lines.
export function beatsFor(song, count) {
  const beats = song.beats.slice(0, count);
  const end = count < song.beats.length ? song.beats[count].lines[0].t : song.end;
  return { beats, end };
}
