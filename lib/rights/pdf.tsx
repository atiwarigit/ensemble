import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { RightsManifest } from "@/lib/services/rights";

// Built-in PDF fonts only cover Latin-1 (WinAnsi). The exact texts are also in versions/*.txt.
// Hashes must never be hyphenated, or a reader copying one gets the wrong value.
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 72, paddingHorizontal: 48, fontSize: 9.5, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6 },
  muted: { color: "#555" },
  mono: { fontFamily: "Courier", fontSize: 8 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 3 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#333", paddingBottom: 3, fontFamily: "Helvetica-Bold" },
  lyrics: { fontFamily: "Courier", fontSize: 8.5, lineHeight: 1.35, marginTop: 4, marginBottom: 8 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 7, color: "#555" },
  watermark: {
    position: "absolute",
    top: 330,
    left: 70,
    fontSize: 110,
    color: "#d33",
    opacity: 0.15,
    transform: "rotate(-35deg)",
    fontFamily: "Helvetica-Bold",
  },
  box: { borderWidth: 0.75, borderColor: "#333", padding: 10, marginTop: 6 },
  line: { borderBottomWidth: 0.75, borderBottomColor: "#333", height: 22, marginBottom: 4 },
});

const ts = (iso: string) => `${iso.slice(0, 19).replace("T", " ")} UTC`;
const ORIGIN: Record<string, string> = {
  human: "Human-written",
  human_edit_of_ai_suggestion: "Human edit of an AI suggestion",
  imported_original: "Older original, entered",
};

function Cell({ w, children, mono }: { w: string; children: React.ReactNode; mono?: boolean }) {
  return <Text style={[{ width: w, paddingRight: 4 }, mono ? s.mono : {}]}>{children}</Text>;
}

export function RightsPdf({ m }: { m: RightsManifest }) {
  const draft = m.kind === "draft";
  return (
    <Document title={`Rights package: ${m.work.title}`} author="Ensemble" subject={m.format}>
      <Page size="LETTER" style={s.page} wrap>
        {draft && (
          <Text style={s.watermark} fixed>
            DRAFT
          </Text>
        )}
        <Text style={s.muted}>Rights documentation package{draft ? " (DRAFT, not finalized)" : ""}</Text>
        <Text style={s.h1}>{m.work.title}</Text>
        <Text>
          Project: {m.project.name}
          {m.project.artistName ? `  |  Artist: ${m.project.artistName}` : ""}
        </Text>
        <Text>
          ISRC: {m.work.isrc ?? "not assigned"}  |  ISWC: {m.work.iswc ?? "not assigned"}  |  Status: {m.work.status}
        </Text>
        <Text style={s.muted}>
          Package {m.packageId}  |  Generated {ts(m.generatedAt)}
        </Text>

        <Text style={s.h2}>1. Contributors and splits</Text>
        <View style={s.head}>
          <Cell w="40%">Name</Cell>
          <Cell w="20%">Role</Cell>
          <Cell w="15%">Share</Cell>
          <Cell w="25%">Human / AI</Cell>
        </View>
        {m.contributors.map((c) => (
          <View key={c.name} style={s.row}>
            <Cell w="40%">{c.name}</Cell>
            <Cell w="20%">{c.role}</Cell>
            <Cell w="15%">{c.sharePct}%</Cell>
            <Cell w="25%">{c.human ? "Human" : "Not human"}</Cell>
          </View>
        ))}

        <Text style={s.h2}>2. Authorship timeline</Text>
        <Text style={s.muted}>
          Recorded times come from the database clock at the moment each version was saved. Dates marked &quot;stated by the
          author&quot; are the author&apos;s claim and are not verified.
        </Text>
        {m.versions.map((v) => (
          <View key={v.id} wrap={false} style={{ marginTop: 8 }}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              Version {v.versionNo}  |  recorded {ts(v.recordedAt)}  |  {v.author ?? "unknown"}  |  {ORIGIN[v.origin] ?? v.origin}
            </Text>
            {v.authorStatedWrittenAt && <Text>Written {v.authorStatedWrittenAt} (stated by the author)</Text>}
            {v.changeNote && <Text>Note: {v.changeNote}</Text>}
            <Text style={s.mono}>SHA-256 {v.contentSha256}</Text>
            {v.auditEventId && (
              <Text style={s.mono}>
                Audit event #{v.auditEventId}  {v.auditEventHash}
              </Text>
            )}
          </View>
        ))}
        <Text style={[s.h2, { fontSize: 10 }]}>Text of version {m.versions.at(-1)!.versionNo} (latest)</Text>
        <Text style={s.lyrics}>{m.versions.at(-1)!.body}</Text>

        <Text style={s.h2}>3. Evidence</Text>
        {m.evidence.length === 0 ? (
          <Text style={s.muted}>No evidence files attached.</Text>
        ) : (
          m.evidence.map((e) => (
            <View key={e.id} style={{ marginBottom: 5 }} wrap={false}>
              <Text>
                {e.filename} ({e.kind}, {Math.round(e.sizeBytes / 1024)} KB){e.versionNo ? `, for version ${e.versionNo}` : ""}  |  added{" "}
                {ts(e.uploadedAt)} by {e.uploadedBy}
              </Text>
              {e.description && <Text style={s.muted}>{e.description}</Text>}
              <Text style={s.mono}>SHA-256 {e.sha256}  ({e.file})</Text>
            </View>
          ))
        )}

        <Text style={s.h2}>4. AI generation log</Text>
        {m.generations.length === 0 ? (
          <Text style={s.muted}>No generations logged.</Text>
        ) : (
          m.generations.map((g, i) => (
            <View key={i} style={{ marginBottom: 5 }} wrap={false}>
              <Text>
                {g.tool} used lyric version {g.versionNo}  |  logged {ts(g.loggedAt)} by {g.loggedBy}
              </Text>
              {g.externalRef && <Text style={s.muted}>{g.externalRef}</Text>}
              <Text style={s.mono}>Lyric SHA-256 {g.versionSha256}</Text>
            </View>
          ))
        )}

        <Text style={s.h2}>5. Human and AI contributions</Text>
        <Text>{m.statement.human}</Text>
        <Text style={{ marginTop: 4 }}>{m.statement.ai}</Text>

        <Text style={s.h2}>6. Audit excerpt</Text>
        <Text style={s.muted}>
          Each event&apos;s hash covers the previous event&apos;s hash, so changing any earlier record breaks every hash after it. Chain
          verified at generation: {m.audit.chainVerified ? "yes" : "NO, BREAK DETECTED"}. Chain head #{m.audit.chainHead?.id}:
        </Text>
        <Text style={s.mono}>{m.audit.chainHead?.hash}</Text>
        <View style={[s.head, { marginTop: 6 }]}>
          <Cell w="6%">#</Cell>
          <Cell w="20%">When</Cell>
          <Cell w="22%">Action</Cell>
          <Cell w="52%">Hash</Cell>
        </View>
        {m.audit.events.map((e) => (
          <View key={e.id} style={[s.row, { fontSize: 7.5 }]} wrap={false}>
            <Cell w="6%">{e.id}</Cell>
            <Cell w="20%">{ts(e.at)}</Cell>
            <Cell w="22%">{e.action}</Cell>
            <Text style={{ width: "52%", fontFamily: "Courier", fontSize: 6.2 }}>{e.hash}</Text>
          </View>
        ))}

        <Text style={s.h2}>7. Author attestation</Text>
        <View style={s.box} wrap={false}>
          <Text>
            I, {m.work.primaryAuthor ?? "________________"}, state that I wrote the lyrics recorded in this package as described above,
            and that the information here is accurate to the best of my knowledge.
          </Text>
          <View style={{ flexDirection: "row", gap: 24, marginTop: 18 }}>
            <View style={{ flex: 2 }}>
              <View style={s.line} />
              <Text style={s.muted}>Signature</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.line} />
              <Text style={s.muted}>Date</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{m.limitation}</Text>
          <Text
            style={{ marginTop: 3 }}
            render={({ pageNumber, totalPages }) =>
              `${m.work.title}  |  package ${m.packageId}${draft ? "  |  DRAFT" : ""}  |  page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function renderRightsPdf(m: RightsManifest) {
  return new Uint8Array(await renderToBuffer(<RightsPdf m={m} />));
}
