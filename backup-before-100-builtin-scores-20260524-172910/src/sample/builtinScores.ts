export type BuiltinScore = {
  id: string;
  title: string;
  composer: string;
  difficulty: string;
  source: string;
  license: string;
  xmlContent: string;
};

type NoteType = "quarter" | "eighth" | "half";

type NoteSpec = {
  step?: string;
  octave?: number;
  alter?: number;
  duration: number;
  type: NoteType;
  rest?: boolean;
};

function noteXml(note: NoteSpec) {
  if (note.rest) {
    return `<note><rest/><duration>${note.duration}</duration><type>${note.type}</type></note>`;
  }

  const alter = note.alter ? `<alter>${note.alter}</alter>` : "";
  return `<note><pitch><step>${note.step}</step>${alter}<octave>${note.octave}</octave></pitch><duration>${note.duration}</duration><type>${note.type}</type></note>`;
}

function makeScoreXml(input: {
  title: string;
  composer: string;
  tempo: number;
  measures: NoteSpec[][];
}) {
  const measureXml = input.measures
    .map(
      (measure, index) => `
    <measure number="${index + 1}">
      ${
        index === 0
          ? `<attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome><beat-unit>quarter</beat-unit><per-minute>${input.tempo}</per-minute></metronome>
        </direction-type>
        <sound tempo="${input.tempo}"/>
      </direction>`
          : ""
      }
      ${measure.map(noteXml).join("\n      ")}
    </measure>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${input.title}</work-title></work>
  <identification><creator type="composer">${input.composer}</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Guitar</part-name></score-part>
  </part-list>
  <part id="P1">${measureXml}
  </part>
</score-partwise>`;
}

const q = (step: string, octave: number, alter = 0): NoteSpec => ({
  step,
  octave,
  alter,
  duration: 2,
  type: "quarter",
});

const e = (step: string, octave: number, alter = 0): NoteSpec => ({
  step,
  octave,
  alter,
  duration: 1,
  type: "eighth",
});

const h = (step: string, octave: number, alter = 0): NoteSpec => ({
  step,
  octave,
  alter,
  duration: 4,
  type: "half",
});

const r = (duration: 1 | 2 | 4): NoteSpec => ({
  duration,
  type: duration === 1 ? "eighth" : duration === 2 ? "quarter" : "half",
  rest: true,
});

export const BUILTIN_SCORES: BuiltinScore[] = [
  {
    id: "builtin-carulli-andantino",
    title: "Carulli Andantino Practice",
    composer: "Ferdinando Carulli",
    difficulty: "Beginner",
    source: "Bundled MusicXML",
    license: "Public domain composer, app-created educational MusicXML",
    xmlContent: makeScoreXml({
      title: "Carulli Andantino Practice",
      composer: "Ferdinando Carulli",
      tempo: 72,
      measures: [
        [q("E", 4), q("G", 4), q("B", 4), q("E", 5)],
        [q("D", 5), q("B", 4), q("G", 4), q("E", 4)],
        [e("F", 4, 1), e("G", 4), e("A", 4), e("B", 4), q("C", 5), q("B", 4)],
        [q("A", 4), q("G", 4), h("E", 4)],
        [q("E", 4), q("F", 4, 1), q("G", 4), q("A", 4)],
        [q("B", 4), e("A", 4), e("G", 4), q("F", 4, 1), q("E", 4)],
        [e("G", 4), e("A", 4), e("B", 4), e("C", 5), q("D", 5), q("B", 4)],
        [q("C", 5), q("B", 4), h("A", 4)],
        [q("A", 4), q("C", 5), q("E", 5), q("C", 5)],
        [q("B", 4), e("C", 5), e("B", 4), q("A", 4), q("G", 4)],
        [e("F", 4, 1), e("G", 4), e("A", 4), e("B", 4), e("C", 5), e("B", 4), e("A", 4), e("G", 4)],
        [q("F", 4, 1), q("E", 4), h("E", 4)],
        [q("G", 4), q("B", 4), q("D", 5), q("B", 4)],
        [q("C", 5), e("B", 4), e("A", 4), q("G", 4), q("F", 4, 1)],
        [e("E", 4), e("F", 4, 1), e("G", 4), e("A", 4), q("B", 4), q("G", 4)],
        [q("E", 4), r(2), h("E", 4)],
      ],
    }),
  },
  {
    id: "builtin-sor-study",
    title: "Sor Study Practice",
    composer: "Fernando Sor",
    difficulty: "Beginner-Intermediate",
    source: "Bundled MusicXML",
    license: "Public domain composer, app-created educational MusicXML",
    xmlContent: makeScoreXml({
      title: "Sor Study Practice",
      composer: "Fernando Sor",
      tempo: 80,
      measures: [
        [e("E", 4), e("F", 4, 1), e("G", 4), e("A", 4), e("B", 4), e("C", 5), e("D", 5), e("E", 5)],
        [e("E", 5), e("D", 5), e("C", 5), e("B", 4), e("A", 4), e("G", 4), e("F", 4, 1), e("E", 4)],
        [q("G", 4), e("A", 4), e("B", 4), q("C", 5), q("B", 4)],
        [e("A", 4), e("G", 4), e("F", 4, 1), e("E", 4), h("E", 4)],
        [e("A", 4), e("B", 4), e("C", 5), e("D", 5), e("E", 5), e("D", 5), e("C", 5), e("B", 4)],
        [q("A", 4), q("C", 5), q("B", 4), q("A", 4)],
        [e("G", 4), e("A", 4), e("B", 4), e("C", 5), q("D", 5), q("E", 5)],
        [q("D", 5), q("B", 4), h("G", 4)],
        [e("E", 4), e("G", 4), e("B", 4), e("E", 5), e("D", 5), e("B", 4), e("G", 4), e("E", 4)],
        [e("F", 4, 1), e("A", 4), e("C", 5), e("F", 5, 1), e("E", 5), e("C", 5), e("A", 4), e("F", 4, 1)],
        [q("G", 4), q("B", 4), q("D", 5), q("G", 5)],
        [q("F", 5, 1), q("E", 5), h("D", 5)],
        [e("C", 5), e("B", 4), e("A", 4), e("G", 4), e("F", 4, 1), e("E", 4), e("D", 4), e("C", 4)],
        [q("D", 4), q("F", 4, 1), q("A", 4), q("C", 5)],
        [q("B", 4), e("A", 4), e("G", 4), q("F", 4, 1), q("E", 4)],
        [h("E", 4), h("E", 4)],
      ],
    }),
  },
  {
    id: "builtin-bach-minuet-practice",
    title: "Bach Minuet Practice",
    composer: "J. S. Bach",
    difficulty: "Intermediate",
    source: "Bundled MusicXML",
    license: "Public domain composer, app-created educational MusicXML",
    xmlContent: makeScoreXml({
      title: "Bach Minuet Practice",
      composer: "J. S. Bach",
      tempo: 84,
      measures: [
        [q("G", 4), q("A", 4), q("B", 4), q("C", 5)],
        [q("D", 5), e("C", 5), e("B", 4), q("A", 4), q("G", 4)],
        [e("B", 4), e("C", 5), e("D", 5), e("E", 5), q("D", 5), q("B", 4)],
        [q("C", 5), q("A", 4), h("G", 4)],
        [q("D", 5), q("E", 5), q("F", 5, 1), q("G", 5)],
        [q("A", 5), e("G", 5), e("F", 5, 1), q("E", 5), q("D", 5)],
        [e("C", 5), e("D", 5), e("E", 5), e("F", 5, 1), q("G", 5), q("E", 5)],
        [q("D", 5), q("B", 4), h("G", 4)],
        [q("C", 5), q("D", 5), q("E", 5), q("C", 5)],
        [q("B", 4), e("C", 5), e("D", 5), q("G", 4), q("B", 4)],
        [e("A", 4), e("B", 4), e("C", 5), e("D", 5), q("E", 5), q("C", 5)],
        [q("B", 4), q("A", 4), h("G", 4)],
        [e("G", 4), e("A", 4), e("B", 4), e("C", 5), e("D", 5), e("C", 5), e("B", 4), e("A", 4)],
        [q("G", 4), q("B", 4), q("D", 5), q("G", 5)],
        [q("F", 5, 1), e("E", 5), e("D", 5), q("C", 5), q("A", 4)],
        [q("B", 4), q("A", 4), h("G", 4)],
      ],
    }),
  },
];
