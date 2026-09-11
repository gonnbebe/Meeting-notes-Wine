import React, { useState, useEffect, useRef } from "react";

/* ------------------------------------------------------------------
   会議ノート — 文字起こしとホワイトボード写真から議事録をつくる
   出力は2層：LINEに貼る短い版 / 読み返す用の詳しい版
------------------------------------------------------------------ */

const ink = "#1F1E1C";
const board = "#F6F7F5";
const paper = "#FFFFFF";
const line = "#DFDFD9";
const dim = "#7C7C74";
const markerRed = "#C0392B";
const markerBlue = "#2B5EA7";

const jp = `"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif`;

const S = {
  page: {
    background: board,
    color: ink,
    fontFamily: jp,
    minHeight: "100vh",
    padding: "20px 16px 64px",
  },
  wrap: { maxWidth: 760, margin: "0 auto" },
  h1: { fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" },
  sub: { fontSize: 13, color: dim, marginTop: 6, lineHeight: 1.7 },
  card: {
    background: paper,
    border: `1px solid ${line}`,
    borderRadius: 4,
    padding: 18,
    marginTop: 18,
  },
  label: { fontSize: 13, fontWeight: 700, display: "block", marginBottom: 6 },
  hint: { fontSize: 12, color: dim, fontWeight: 400, marginLeft: 8 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: `1px solid ${line}`,
    borderRadius: 3,
    padding: "9px 10px",
    fontSize: 14,
    fontFamily: jp,
    color: ink,
    background: paper,
    outline: "none",
  },
  area: {
    width: "100%",
    boxSizing: "border-box",
    border: `1px solid ${line}`,
    borderRadius: 3,
    padding: "10px",
    fontSize: 14,
    lineHeight: 1.7,
    fontFamily: jp,
    color: ink,
    background: paper,
    outline: "none",
    resize: "vertical",
  },
  field: { marginTop: 16 },
  run: {
    width: "100%",
    marginTop: 20,
    padding: "13px 16px",
    background: ink,
    color: paper,
    border: "none",
    borderRadius: 3,
    fontSize: 15,
    fontWeight: 700,
    fontFamily: jp,
    cursor: "pointer",
  },
  runOff: { background: "#B9B9B2", cursor: "not-allowed" },
  ghost: {
    padding: "7px 12px",
    background: paper,
    color: ink,
    border: `1px solid ${line}`,
    borderRadius: 3,
    fontSize: 12,
    fontFamily: jp,
    cursor: "pointer",
  },
  lineBox: {
    background: "#FAFAF8",
    border: `1px solid ${line}`,
    borderLeft: `3px solid ${markerBlue}`,
    borderRadius: 3,
    padding: "14px 16px",
    whiteSpace: "pre-wrap",
    fontSize: 14,
    lineHeight: 1.85,
  },
  secTitle: {
    fontSize: 14,
    fontWeight: 700,
    margin: "0 0 10px",
    paddingBottom: 6,
    borderBottom: `1px solid ${line}`,
  },
  item: { fontSize: 14, lineHeight: 1.75, marginBottom: 12 },
  reason: { fontSize: 13, color: dim, lineHeight: 1.75, marginTop: 3 },
  err: {
    background: "#FDF3F2",
    border: `1px solid ${markerRed}`,
    borderRadius: 3,
    padding: 14,
    fontSize: 13,
    lineHeight: 1.7,
    color: markerRed,
    marginTop: 18,
  },
};

const GOAL_TONE = {
  達成: markerBlue,
  一部達成: "#9A7B1F",
  未達: markerRed,
};

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* 写真は長辺1400pxに縮めてから送る。文字は読めるまま、データ量だけ減らす */
function shrink(file, max = 1400) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.82).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

/* 出力が途中で切れても、読める範囲までを拾う */
function parseLoose(raw) {
  const t = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const cut = t.lastIndexOf("}");
    if (cut === -1) throw e;
    let s = t.slice(0, cut + 1);
    const stack = [];
    for (const ch of s) {
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    while (stack.length) s += stack.pop() === "{" ? "}" : "]";
    return JSON.parse(s);
  }
}

function readRaw(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("読み込めませんでした"));
    r.readAsDataURL(file);
  });
}

function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const CHUNK = 20000;

function splitText(t) {
  if (t.length <= CHUNK) return [t];
  const parts = [];
  for (let i = 0; i < t.length; i += CHUNK) parts.push(t.slice(i, i + CHUNK));
  return parts;
}

function buildBoardPrompt(n) {
  return `ホワイトボードの写真${n}枚です。書かれている内容を、そのまま文字に起こしてください。

- 見出し、矢印のつながり、囲み、色の違いも分かる形で書く。
- 読めない字は「（判読不可）」と書く。想像で補わない。
- 解釈や要約はしない。書いてあることだけ。
- 説明や前置きはつけず、書き起こしだけを返す。`;
}

function buildChunkPrompt({ goal, index, total, prev, chunk }) {
  return `会議の文字起こしを${total}分割した、その${index}番目です。ここから要点だけ抜き出します。

今日のゴール: ${goal}
${prev ? `ここまでに分かっていること:\n${prev}\n` : ""}
# 守ること
- 発言にある事実だけを書く。推測で補わない。
- 「決まったこと」「理由」「採らなかった案とその理由」「宿題」「保留」に当たる発言を優先して拾う。
- 雑談や言い直しは捨てる。
- 15行以内。1行1項目。説明や前置きはつけず、箇条書きだけを返す。

# 文字起こし（${index}/${total}）
${chunk}`;
}

function buildMergePrompt({ date, goal, carry, boardText, notes, part }) {
  const specs = {
    decisions: {
      what: "この会議で決まったこと",
      rule: `- ホワイトボードに書いてあっても、発言の中で採用されなかった案は入れない。
- 「なぜそう決まったか」を必ず添える。理由のない決定事項は書かない。
- 多くても6件。重要なものから並べる。`,
      json: `{"decisions": [{"title": "決めたこと1行", "logic": "そこに至った理由を1〜2文"}]}`,
    },
    rejected: {
      what: "検討したが採らなかった案と、その理由",
      rule: `- ホワイトボードに書かれたまま議論で流れた案も拾う。
- なぜ採らなかったかを1文で書く。理由が記録にないものは「理由の記載なし」と書く。
- 多くても8件。`,
      json: `{"rejected": [{"idea": "採らなかった案", "reason": "採らなかった理由を1文"}]}`,
    },
    pending: {
      what: "未決定・次回への持ち越し事項",
      rule: `- 決まらなかったこと、保留になったこと、確認が必要なことを拾う。
- 1行ずつ、多くても8件。`,
      json: `{"pending": ["持ち越し事項を1行ずつ"]}`,
    },
  };
  const s = specs[part];
  return `ある会議の記録から、${s.what}だけを抜き出します。

会議日: ${date}
今日のゴール: ${goal}
前回からの持ち越し: ${carry || "（なし）"}

# ホワイトボードの書き起こし
${boardText || "（写真なし）"}

# 発言から抜き出した要点
${notes}

# 守ること
- 記録にある事実だけを書く。推測で補わない。
- 同じ内容が重複していたらひとつにまとめる。
${s.rule}

# 出力
次のJSONだけを返す。前置き、説明、コードフェンスは一切つけない。

${s.json}`;
}

function buildSummaryPrompt({ date, goal, core }) {
  return `次は、ある会議から抽出した記録です。これをもとに共有用のまとめをつくります。

会議日: ${date}
今日のゴール: ${goal}

抽出済みの記録:
${JSON.stringify(core, null, 1)}

# 守ること
- lineSummary はLINEにそのまま貼る。10行以内。記号やマークダウンは使わない。箇条書きは数字と中黒のみ。
- 担当が記録から読み取れない場合は「未確定」と書く。勝手に人名を割り当てない。
- 記録にない事実を足さない。

# 出力
次のJSONだけを返す。前置き、説明、コードフェンスは一切つけない。

{
  "goalStatus": "達成" または "一部達成" または "未達",
  "goalReason": "そう判断した理由を1〜2文",
  "lineSummary": "LINEに貼る短い版。改行込みのプレーンテキスト",
  "nextGoal": "次回のゴール案を1行",
  "nextActions": [{"who": "担当", "when": "期限", "what": "やること"}],
  "saveData": "次回の冒頭で全員が思い出すべき前提を3〜5文"
}`;
}

export default function MeetingNotes() {
  const [date, setDate] = useState(today());
  const [goal, setGoal] = useState("");
  const [carry, setCarry] = useState("");
  const [transcript, setTranscript] = useState("");
  const [photos, setPhotos] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("meeting-notes");
        const list = r ? JSON.parse(r.value) : [];
        setHistory(list);
        if (list.length && list[0].pending?.length) {
          setCarry(list[0].pending.join("、"));
        }
      } catch {
        setHistory([]);
      }
      setLoadingHistory(false);
    })();
  }, []);

  const [photoError, setPhotoError] = useState("");

  async function addPhotos(files) {
    setPhotoError("");
    const picked = Array.from(files);
    if (!picked.length) return;
    const next = [];
    const failed = [];

    for (const f of picked.slice(0, 8)) {
      try {
        const data = await shrink(f);
        next.push({ name: f.name, media: "image/jpeg", data });
      } catch (e1) {
        // 縮小できない形式は、そのまま送れるかどうかで判断する
        const ok = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        if (ok.includes(f.type)) {
          try {
            const data = await readRaw(f);
            next.push({ name: f.name, media: f.type, data });
          } catch (e2) {
            failed.push(f.name);
          }
        } else {
          failed.push(f.name);
        }
      }
    }

    if (next.length) setPhotos((p) => [...p, ...next].slice(0, 8));
    if (failed.length) {
      setPhotoError(
        `${failed.join("、")} を読み込めませんでした。iPhoneの写真はHEIC形式のことがあります。写真アプリで開いて「コピーを保存」するか、スクリーンショットを撮って選び直してください。`
      );
    }
  }

  async function callText(content) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "失敗");
    return (data.content || [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
  }

  async function callJson(content) {
    return parseLoose(await callText(content));
  }

  async function generate() {
    setBusy(true);
    setError("");
    setResult(null);
    const troubles = [];
    try {
      // 1. 写真を4枚ずつ文字に起こす
      let boardText = "";
      const batches = [];
      for (let i = 0; i < photos.length; i += 4) {
        batches.push(photos.slice(i, i + 4));
      }
      const chunks = splitText(transcript);
      const total = batches.length + chunks.length + 4;
      let step = 0;
      const tick = (label) => setStage(`${label} ${++step}/${total}`);

      for (let i = 0; i < batches.length; i++) {
        tick("ホワイトボードを読んでいます");
        const content = batches[i].map((p) => ({
          type: "image",
          source: { type: "base64", media_type: p.media, data: p.data },
        }));
        content.push({ type: "text", text: buildBoardPrompt(batches[i].length) });
        boardText += (await callText(content)) + "\n\n";
      }

      // 2. 文字起こしを分けて要点にする
      const notes = [];
      for (let i = 0; i < chunks.length; i++) {
        tick("会議の内容を読んでいます");
        const t = await callText([
          {
            type: "text",
            text: buildChunkPrompt({
              goal,
              index: i + 1,
              total: chunks.length,
              prev: notes[notes.length - 1] || "",
              chunk: chunks[i],
            }),
          },
        ]);
        notes.push(t);
      }

      const noteText = notes.join("\n");

      // 3. 決定・棄却・持ち越しを別々に書き出す
      const parts = [
        ["decisions", "決まったことを整理しています"],
        ["rejected", "採らなかった案を整理しています"],
        ["pending", "持ち越しを整理しています"],
      ];
      const core = { decisions: [], rejected: [], pending: [] };
      for (const [key, label] of parts) {
        tick(label);
        try {
          const r = await callJson([
            {
              type: "text",
              text: buildMergePrompt({
                date,
                goal,
                carry,
                boardText,
                notes: noteText,
                part: key,
              }),
            },
          ]);
          core[key] = r[key] || [];
        } catch (e) {
          troubles.push(label);
        }
      }

      // 4. 共有用にまとめる
      tick("共有用にまとめています");
      let merged = core;
      try {
        const tail = await callJson([
          { type: "text", text: buildSummaryPrompt({ date, goal, core }) },
        ]);
        merged = { ...core, ...tail };
      } catch (e) {
        troubles.push("共有用のまとめ");
      }
      setResult(merged);
      await save(merged);
      if (troubles.length) {
        setError(
          `${troubles.join("、")} だけ作れませんでした。出ている内容はそのまま使えます。もう一度実行すると揃うことがあります。`
        );
      }
    } catch (e) {
      setError(
        "途中で止まりました。もう一度実行すると通ることがあります。同じところで止まる場合は、写真を減らして試してください。"
      );
    }
    setBusy(false);
    setStage("");
  }

  async function save(r) {
    const record = { id: Date.now(), date, goal, ...r };
    const next = [record, ...history].slice(0, 30);
    setHistory(next);
    try {
      await window.storage.set("meeting-notes", JSON.stringify(next));
    } catch {
      /* 保存に失敗しても画面の内容は残る */
    }
  }

  function copy(text, tag) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(""), 1600);
    });
  }

  function fullText(r) {
    const L = [];
    L.push(`${shortDate(date)} 議事録`);
    L.push(`ゴール：${goal}`);
    L.push(`達成度：${r.goalStatus}　${r.goalReason}`);
    L.push("");
    L.push("■ 決めたこと");
    r.decisions?.forEach((d, i) => {
      L.push(`${i + 1}. ${d.title}`);
      L.push(`　理由：${d.logic}`);
    });
    L.push("");
    L.push("■ 検討したが採らなかったこと");
    r.rejected?.forEach((x) => L.push(`・${x.idea} → ${x.reason}`));
    L.push("");
    L.push("■ 持ち越し");
    r.pending?.forEach((x) => L.push(`・${x}`));
    L.push("");
    L.push("■ 次回");
    L.push(`ゴール案：${r.nextGoal}`);
    r.nextActions?.forEach((a) =>
      L.push(`・${a.who}／${a.when}／${a.what}`)
    );
    L.push("");
    L.push("■ 次回までに思い出すこと");
    L.push(r.saveData || "");
    return L.join("\n");
  }

  const ready = goal.trim() && transcript.trim() && !busy;

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>会議ノート</h1>
        <p style={S.sub}>
          文字起こしとホワイトボードの写真から議事録をつくります。
          LINEに貼る短い版と、あとで読み返す詳しい版が出ます。
        </p>

        {/* 入力 */}
        <div style={S.card}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 150px" }}>
              <label style={S.label} htmlFor="d">
                会議日
              </label>
              <input
                id="d"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={S.input}
              />
            </div>
            <div style={{ flex: "1 1 240px", minWidth: 200 }}>
              <label style={S.label} htmlFor="g">
                今日のゴール
                <span style={S.hint}>この会議で何を決めるか</span>
              </label>
              <input
                id="g"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="どんな方法でワインを知ってもらうかを決める"
                style={S.input}
              />
            </div>
          </div>

          <div style={S.field}>
            <label style={S.label} htmlFor="c">
              前回からの持ち越し
              <span style={S.hint}>前回の記録から自動で入ります</span>
            </label>
            <textarea
              id="c"
              rows={2}
              value={carry}
              onChange={(e) => setCarry(e.target.value)}
              placeholder={
                loadingHistory ? "読み込み中" : "まだ記録がありません"
              }
              style={S.area}
            />
          </div>

          <div style={S.field}>
            <label style={S.label} htmlFor="t">
              文字起こし
              <span style={S.hint}>ボイスメモの文字起こしをそのまま貼る</span>
            </label>
            <textarea
              id="t"
              rows={9}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="ここに貼り付け"
              style={S.area}
            />
            <div style={{ fontSize: 12, color: dim, marginTop: 5 }}>
              {transcript.length.toLocaleString()} 文字
              {transcript.length > CHUNK
                ? `　${splitText(transcript).length}回に分けて読みます`
                : ""}
            </div>
          </div>

          <div style={S.field}>
            <label style={S.label}>
              ホワイトボードの写真
              <span style={S.hint}>8枚まで</span>
            </label>
            <button style={S.ghost} onClick={() => fileRef.current?.click()}>
              写真を選ぶ
            </button>
            <span style={{ fontSize: 12, color: dim, marginLeft: 10 }}>
              {photos.length > 0 ? `${photos.length}枚 選択中` : "未選択"}
            </span>
            {photoError && (
              <div
                style={{
                  fontSize: 12,
                  color: markerRed,
                  lineHeight: 1.7,
                  marginTop: 8,
                }}
              >
                {photoError}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addPhotos(e.target.files);
                e.target.value = "";
              }}
            />
            {photos.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {photos.map((p, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img
                      src={`data:${p.media};base64,${p.data}`}
                      alt=""
                      style={{
                        width: 76,
                        height: 56,
                        objectFit: "cover",
                        border: `1px solid ${line}`,
                        borderRadius: 3,
                        display: "block",
                      }}
                    />
                    <button
                      aria-label="この写真を外す"
                      onClick={() =>
                        setPhotos(photos.filter((_, k) => k !== i))
                      }
                      style={{
                        position: "absolute",
                        top: -7,
                        right: -7,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        border: `1px solid ${line}`,
                        background: paper,
                        color: ink,
                        fontSize: 12,
                        lineHeight: "18px",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            style={{ ...S.run, ...(ready ? {} : S.runOff) }}
            disabled={!ready}
            onClick={generate}
          >
            {busy ? stage || "つくっています" : "議事録をつくる"}
          </button>
          {!busy && (!goal.trim() || !transcript.trim()) ? (
            <div style={{ fontSize: 12, color: markerRed, marginTop: 8 }}>
              {!goal.trim() && !transcript.trim()
                ? "「今日のゴール」と「文字起こし」が空です。"
                : !goal.trim()
                ? "「今日のゴール」が空です。この会議で何を決めるかを一行で入れてください。"
                : "「文字起こし」が空です。"}
            </div>
          ) : null}
        </div>

        {error && <div style={S.err}>{error}</div>}

        {/* 出力 */}
        {result && (
          <>
            {result.lineSummary && (
            <div style={S.card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  LINEに貼る版
                </div>
                <button
                  style={S.ghost}
                  onClick={() => copy(result.lineSummary, "line")}
                >
                  {copied === "line" ? "コピーしました" : "コピー"}
                </button>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: GOAL_TONE[result.goalStatus] || ink,
                  marginBottom: 10,
                }}
              >
                ゴール {result.goalStatus}
                <span
                  style={{ fontWeight: 400, color: dim, marginLeft: 8 }}
                >
                  {result.goalReason}
                </span>
              </div>
              <div style={S.lineBox}>{result.lineSummary}</div>
            </div>
            )}

            <div style={S.card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  詳しい版
                  <span style={S.hint}>ひらいて読む</span>
                </div>
                <button
                  style={S.ghost}
                  onClick={() => copy(fullText(result), "full")}
                >
                  {copied === "full" ? "コピーしました" : "全文コピー"}
                </button>
              </div>

              <Fold title={`決めたこと（${result.decisions?.length || 0}）`} open>
                {result.decisions?.map((d, i) => (
                  <div key={i} style={S.item}>
                    <span style={{ fontWeight: 700 }}>
                      {i + 1}. {d.title}
                    </span>
                    <div style={S.reason}>理由：{d.logic}</div>
                  </div>
                ))}
              </Fold>

              <Fold
                title={`検討したが採らなかったこと（${
                  result.rejected?.length || 0
                }）`}
              >
                {result.rejected?.map((x, i) => (
                  <div key={i} style={S.item}>
                    <span style={{ color: dim, textDecoration: "line-through" }}>
                      {x.idea}
                    </span>
                    <div style={S.reason}>{x.reason}</div>
                  </div>
                ))}
              </Fold>

              <Fold title={`持ち越し（${result.pending?.length || 0}）`}>
                {result.pending?.map((x, i) => (
                  <div key={i} style={S.item}>
                    ・{x}
                  </div>
                ))}
              </Fold>

              <Fold title="次回" open>
                <div
                  style={{
                    ...S.item,
                    borderLeft: `3px solid ${markerRed}`,
                    paddingLeft: 10,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>ゴール案</span>
                  <div style={{ marginTop: 2 }}>{result.nextGoal}</div>
                </div>
                {result.nextActions?.map((a, i) => (
                  <div key={i} style={S.item}>
                    {a.what}
                    <div style={S.reason}>
                      {a.who}／{a.when}
                    </div>
                  </div>
                ))}
                <div style={{ ...S.item, color: dim }}>{result.saveData}</div>
              </Fold>
            </div>
          </>
        )}

        {/* 履歴 */}
        {history.length > 0 && (
          <div style={S.card}>
            <div style={S.secTitle}>これまでの会議</div>
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  setResult(h);
                  setDate(h.date);
                  setGoal(h.goal);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  borderBottom: `1px solid ${line}`,
                  padding: "10px 0",
                  cursor: "pointer",
                  fontFamily: jp,
                  color: ink,
                  fontSize: 14,
                }}
              >
                <span style={{ fontWeight: 700, marginRight: 10 }}>
                  {shortDate(h.date)}
                </span>
                {h.goal}
                <span
                  style={{
                    fontSize: 12,
                    color: GOAL_TONE[h.goalStatus] || dim,
                    marginLeft: 8,
                  }}
                >
                  {h.goalStatus}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Fold({ title, children, open = false }) {
  return (
    <details open={open} style={{ marginTop: 14 }}>
      <summary
        style={{
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          padding: "8px 0",
          borderBottom: `1px solid ${line}`,
          listStyle: "revert",
        }}
      >
        {title}
      </summary>
      <div style={{ paddingTop: 12 }}>{children}</div>
    </details>
  );
}
