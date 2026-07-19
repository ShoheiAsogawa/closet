import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Check, Plus, SpinnerGap, Trash, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import "./import-flow.css";

const API = "/api/import/jobs";
const CONFIG_API = "/api/import/config";
const PARTS = [
  ["upperbody", "トップス"],
  ["wholebody_up", "アウター"],
  ["lowerbody", "ボトムス"],
  ["accessories_up", "小物"],
  ["shoes", "シューズ"],
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error("画像を読み込めませんでした。"));
  reader.readAsDataURL(file);
});

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "インポート処理を更新できませんでした。");
  return value;
}

function deriveStatus(job) {
  const crop = job.stages?.crop;
  const garment = job.stages?.garment;
  const modeled = job.stages?.modeled;
  if (job.error || crop?.status === "failed" || garment?.status === "failed" || modeled?.status === "failed") return { tone: "error", text: "確認が必要です", detail: crop?.error || garment?.error || modeled?.error || job.error };
  if (modeled?.status === "review") return { tone: "ready", text: "着用イメージの確認待ち" };
  if (modeled?.status === "processing") return { tone: "processing", text: "着用イメージを作成中" };
  if (garment?.status === "review") return { tone: "ready", text: "確認待ち" };
  if (garment?.status === "approved") return { tone: "processing", text: "着用イメージを準備中" };
  if (crop?.status === "review") return { tone: "ready", text: "切り抜きの確認待ち" };
  if (crop?.status === "approved") return { tone: "processing", text: "服の画像を作成中" };
  if (crop?.status === "rejected" || garment?.status === "rejected" || modeled?.status === "rejected") return { tone: "complete", text: "インポートを見送りました" };
  return { tone: "processing", text: "写真から服を取り出しています" };
}

function reviewStageFor(job) {
  if (job.stages?.modeled?.status === "review") return "modeled";
  if (job.stages?.garment?.status === "review") return "garment";
  if (job.stages?.crop?.status === "review") return "crop";
  return null;
}

function hasCleanupFailure(job) {
  return job.stages?.garment?.status === "failed" && Boolean(job.stages?.garment?.failedAssetUrl);
}

function defaultDraft(job) {
  const metadata = job.metadata || {};
  return {
    name: metadata.name || "新しい一着",
    part: metadata.part || "upperbody",
    color: metadata.color || "#d8d0c2",
    secondaryColor: metadata.secondaryColor || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags.join(", ") : (metadata.tags || ""),
  };
}

function ReviewEditor({ job, stage, draft, setDraft, regenPrompt, setRegenPrompt, busy, onAction }) {
  const asset = job.stages[stage]?.assetUrl;
  const isCrop = stage === "crop";
  const isGarment = stage === "garment";
  const primaryValid = HEX_COLOR.test(draft.color);
  const secondaryValid = !draft.secondaryColor || HEX_COLOR.test(draft.secondaryColor);
  return (
    <div className="import-editor">
      <img className="import-editor__preview" src={asset} alt={isCrop ? "検出された切り抜き" : isGarment ? "切り出した服" : "生成された着用イメージ"} />
      <div className="import-fields">
        <p className="import-editor__stage">{isCrop ? "検出されたアイテム" : isGarment ? "服の画像" : "着用イメージ"}</p>
        {isCrop ? <p className="import-card__detail">この切り抜きに目的の服がきちんと入っているか確認してください。OKするときれいな服画像の生成が始まります。</p> : isGarment ? (
          <>
            <div className="import-field"><label htmlFor={`name-${job.id}`}>名前</label><input id={`name-${job.id}`} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className="import-field"><label htmlFor={`part-${job.id}`}>カテゴリ</label><select id={`part-${job.id}`} value={draft.part} onChange={(event) => setDraft({ ...draft, part: event.target.value })}>{PARTS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></div>
            <div className="import-field"><label htmlFor={`primary-${job.id}`}>メインカラー</label><div className="import-color-row"><input id={`primary-${job.id}`} type="color" value={primaryValid ? draft.color : "#000000"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><input aria-label="メインカラーのHEX" aria-invalid={!primaryValid} value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></div>{!primaryValid && <small className="import-field-error">#d8d0c2 のような6桁のHEXカラーを入力してください。</small>}</div>
            <div className="import-field"><label htmlFor={`secondary-${job.id}`}>サブカラー <span>任意</span></label><input id={`secondary-${job.id}`} type="text" aria-invalid={!secondaryValid} placeholder="#hex または空欄" value={draft.secondaryColor} onChange={(event) => setDraft({ ...draft, secondaryColor: event.target.value })} />{!secondaryValid && <small className="import-field-error">6桁のHEXカラーか、空欄にしてください。</small>}</div>
            <div className="import-field"><label htmlFor={`tags-${job.id}`}>詳細</label><input id={`tags-${job.id}`} value={draft.tags} placeholder="カジュアル, コットン, ボーダー" onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></div>
          </>
        ) : <p className="import-card__detail">この着用イメージをクローゼットに追加するか、もっと具体的な指示で再生成できます。</p>}
        {!isCrop && <div className="import-field import-regenerate-field">
          <label htmlFor={`regenerate-${job.id}-${stage}`}>再生成の指示 <span>任意</span></label>
          <textarea id={`regenerate-${job.id}-${stage}`} rows="3" value={regenPrompt} onChange={(event) => setRegenPrompt(event.target.value)} placeholder={isGarment ? "例: 元のジッパーを残して、値札は消して" : "例: 静かな夜の街並みで、服全体が見えるように"} />
        </div>}
        <div className="import-actions">
          <button className="import-button" disabled={busy} onClick={() => onAction("reject")}><Trash size={14} /> 見送る</button>
          {!isCrop && <button className="import-button" disabled={busy} onClick={() => onAction("regenerate", regenPrompt)}><ArrowCounterClockwise size={14} /> 再生成</button>}
          <button className="import-button import-button--primary" disabled={busy || (isGarment && (!draft.name.trim() || !primaryValid || !secondaryValid))} onClick={() => onAction("approve")}><Check size={14} weight="bold" /> {isCrop ? "この切り抜きを使う" : "OK"}</button>
        </div>
      </div>
    </div>
  );
}

function CleanupEditor({ job, tolerance, setTolerance, busy, onPreview, onAccept }) {
  const stage = job.stages.garment;
  const contaminated = stage.cleanupDiagnostics?.contaminatedPixels;
  const previewTimer = useRef(null);
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  const updateTolerance = (next) => {
    setTolerance(next);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => onPreview(next), 300);
  };
  return (
    <div className="import-cleanup-editor">
      <p className="import-editor__stage">背景のクリーンアップ</p>
      <p className="import-card__detail">生成された服はそのまま残しています。下でクリーンアップの強さを調整できます（画像モデルは再呼び出ししません）。</p>
      <div className="import-cleanup-comparison">
        <figure><img src={stage.failedAssetUrl} alt="クロマ背景つきの生成結果" /><figcaption>生成元</figcaption></figure>
        <figure><img src={stage.cleanupPreviewUrl || stage.failedAssetUrl} alt="透過クリーンアップのプレビュー" /><figcaption>{stage.cleanupPreviewUrl ? "クリーンアッププレビュー" : "ここにプレビューが出ます"}</figcaption></figure>
      </div>
      <div className="import-field import-cleanup-strength">
        <label htmlFor={`cleanup-${job.id}`}>クリーンアップの強さ <strong>{tolerance}</strong></label>
        <input id={`cleanup-${job.id}`} type="range" min="18" max="110" step="2" value={tolerance} onChange={(event) => updateTolerance(Number(event.target.value))} />
        <div className="import-cleanup-scale"><span>端のディテールを残す</span><span>背景をもっと消す</span></div>
      </div>
      {Number.isFinite(contaminated) && <p className="import-card__detail">自動チェックでは色づいた端のピクセルが {contaminated.toLocaleString("ja-JP")} 個あります。プレビューがきれいなら、そのまま使って大丈夫です。</p>}
      <div className="import-actions">
        <button className="import-button" disabled={busy} onClick={() => onPreview(tolerance)}><ArrowCounterClockwise size={14} /> プレビュー</button>
        <button className="import-button import-button--primary" disabled={busy} onClick={onAccept}><Check size={14} weight="bold" /> このクリーンアップを使う</button>
      </div>
    </div>
  );
}

export function ClosetImportFlow({ onGarmentApproved, onModeledApproved }) {
  const inputRef = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [regenerationPrompts, setRegenerationPrompts] = useState({});
  const [cleanupTolerances, setCleanupTolerances] = useState({});
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [setup, setSetup] = useState(null);

  useEffect(() => {
    api(CONFIG_API).then(setSetup).catch((requestError) => setSetup({ ready: false, error: requestError.message }));
    api(API)
      .then((storedJobs) => {
        const visibleJobs = storedJobs.filter((job) => job.status !== "complete" && job.stages?.crop?.status !== "rejected" && job.stages?.garment?.status !== "rejected" && job.stages?.modeled?.status !== "rejected");
        setJobs(visibleJobs);
        setDrafts(Object.fromEntries(visibleJobs.map((job) => [job.id, defaultDraft(job)])));
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async (id) => {
    try {
      const next = await api(`${API}/${id}`);
      setJobs((current) => current.map((job) => job.id === id ? next : job));
      setDrafts((current) => current[id] ? current : { ...current, [id]: defaultDraft(next) });
    } catch (requestError) { setError(requestError.message); }
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => (job.stages?.crop?.status === "approved" && ["processing", "pending", "queued"].includes(job.stages?.garment?.status)) || ["processing", "queued"].includes(job.stages?.modeled?.status) || (job.stages?.garment?.status === "approved" && job.stages?.modeled?.status === "pending"))) return undefined;
    const timer = setInterval(() => jobs.forEach((job) => refresh(job.id)), 900);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const submitFiles = useCallback(async (files) => {
    if (!setup?.ready) { setOpen(true); return; }
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    setDragging(false); setError(""); setNotice(null);
    for (const file of images) {
      try {
        const imageDataUrl = await fileToDataUrl(file);
        const result = await api(API, { method: "POST", body: JSON.stringify({ imageDataUrl, metadata: { name: file.name.replace(/\.[^.]+$/, "") } }) });
        const createdJobs = result.jobs || [result];
        if (!createdJobs.length && result.noClothingDetected) {
          setNotice({ tone: "complete", text: "服が見つかりませんでした", detail: `${file.name} からはっきりしたウェアを見つけられませんでした。もう少し寄った写真を試してみてください。` });
          setOpen(true);
          continue;
        }
        setJobs((current) => [...current, ...createdJobs]);
        setDrafts((current) => ({ ...current, ...Object.fromEntries(createdJobs.map((job) => [job.id, defaultDraft(job)])) }));
      } catch (requestError) { setError(requestError.message); }
    }
  }, [setup]);

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (event) => { if (![...event.dataTransfer.types].includes("Files")) return; event.preventDefault(); depth += 1; setDragging(true); };
    const onDragOver = (event) => { if ([...event.dataTransfer.types].includes("Files")) event.preventDefault(); };
    const onDragLeave = (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onDrop = (event) => { event.preventDefault(); depth = 0; setDragging(false); submitFiles(event.dataTransfer.files); };
    const onPaste = (event) => { const files = [...event.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); submitFiles(files); } };
    window.addEventListener("dragenter", onDragEnter); window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop); window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop); window.removeEventListener("paste", onPaste); };
  }, [submitFiles]);

  const perform = async (job, stage, action, prompt = "") => {
    setBusyId(job.id); setError("");
    try {
      if (stage === "garment" && action === "approve") {
        const draft = drafts[job.id];
        const metadata = { ...draft, secondaryColor: draft.secondaryColor || null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
        await api(`${API}/${job.id}/metadata`, { method: "PATCH", body: JSON.stringify({ metadata }) });
        const updated = await api(`${API}/${job.id}/stages/garment/approve`, { method: "POST" });
        const garmentPath = `/api/import/library/import-${job.id}-garment.png`;
        onGarmentApproved?.({ id: `import-${job.id}`, ...metadata, image: garmentPath, thumbnail: garmentPath, modeledImage: null, palette: [metadata.color, metadata.secondaryColor].filter(Boolean), importJobId: job.id });
        setJobs((current) => current.map((item) => item.id === job.id ? updated : item));
      } else {
        const updated = await api(`${API}/${job.id}/stages/${stage}/${action}`, { method: "POST", body: action === "regenerate" ? JSON.stringify({ prompt }) : undefined });
        const removeFromQueue = action === "reject" || (stage === "modeled" && action === "approve");
        const remainingJobs = removeFromQueue ? jobs.filter((item) => item.id !== job.id) : null;
        setJobs((current) => removeFromQueue ? current.filter((item) => item.id !== job.id) : current.map((item) => item.id === job.id ? updated : item));
        if (removeFromQueue) {
          setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
          setSelectedReviewId(null);
          if (!remainingJobs.length) setOpen(false);
        }
        if (action === "regenerate") setRegenerationPrompts((current) => ({ ...current, [`${job.id}:${stage}`]: "" }));
        if (stage === "modeled" && action === "approve") onModeledApproved?.(job.id, `/api/import/library/import-${job.id}-modeled.png`);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  const performCleanup = async (job, action, requestedTolerance) => {
    setBusyId(job.id); setError("");
    try {
      const tolerance = requestedTolerance ?? cleanupTolerances[job.id] ?? job.stages?.garment?.cleanupTolerance ?? 46;
      const updated = await api(`${API}/${job.id}/stages/garment/cleanup-${action}`, { method: "POST", body: JSON.stringify({ tolerance }) });
      setJobs((current) => current.map((item) => item.id === job.id ? updated : item));
      setCleanupTolerances((current) => ({ ...current, [job.id]: updated.stages?.garment?.cleanupTolerance ?? tolerance }));
      setSelectedReviewId(job.id);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  const deleteJob = async (job) => {
    setBusyId(job.id); setError("");
    try {
      await api(`${API}/${job.id}`, { method: "DELETE" });
      const remaining = jobs.filter((item) => item.id !== job.id);
      setJobs(remaining);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
      if (selectedReviewId === job.id) setSelectedReviewId(null);
      if (!remaining.length) setOpen(false);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  const active = jobs[jobs.length - 1];
  const setupRequired = setup?.ready === false;
  const activeStatus = setupRequired ? { tone: "error", text: "セットアップが必要です" } : active ? deriveStatus(active) : notice;
  const readyCount = jobs.filter((job) => deriveStatus(job).tone === "ready").length;
  const selectedReviewJob = jobs.find((job) => job.id === selectedReviewId && (reviewStageFor(job) || hasCleanupFailure(job)));
  const reviewJob = selectedReviewJob || jobs.find((job) => reviewStageFor(job)) || jobs.find((job) => hasCleanupFailure(job)) || active;
  const reviewStage = reviewJob ? reviewStageFor(reviewJob) : null;
  const progress = 0;
  const hasImportActivity = Boolean(jobs.length || notice || setupRequired);

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden disabled={!setup?.ready} onChange={(event) => { submitFiles(event.target.files); event.target.value = ""; }} />
      <div className="import-drop-overlay" data-active={dragging && !setupRequired} aria-hidden={!dragging || setupRequired}><div className="import-drop-target is-over"><UploadSimple size={34} weight="light" /><h2>服の写真をドロップ</h2><p>1着でも、全身コーデの写真でもOK。クローゼットはそのまま待ってます。</p></div></div>
      <aside className={`import-tray${hasImportActivity ? " is-expanded" : ""}`} aria-label="クローゼットへの追加">
        <button className="import-tray__button" type="button" onClick={() => setupRequired || hasImportActivity ? setOpen(true) : inputRef.current?.click()} aria-label={setupRequired ? "セットアップ手順を開く" : hasImportActivity ? "インポートの進捗を開く" : "服を追加"}>{activeStatus?.tone === "processing" ? <SpinnerGap size={19} className="import-spinner" /> : activeStatus?.tone === "error" ? <WarningCircle size={19} /> : readyCount ? <span>{readyCount}</span> : notice ? <X size={18} /> : <Plus size={19} />}</button>
        <div className="import-tray__actions">{active && <img className="import-tray__preview" src={active.stages?.garment?.assetUrl || active.stages?.garment?.failedAssetUrl || active.stages?.crop?.assetUrl || active.originalAssetUrl} alt="" />}<span className="import-tray__label">{activeStatus?.text || "服を追加"}</span>{!setupRequired && <button className="import-icon-button" type="button" onClick={() => inputRef.current?.click()} aria-label="画像を選ぶ"><UploadSimple size={17} /></button>}</div>
      </aside>
      <div className="import-popover-backdrop" data-open={open} onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section className="import-popover" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header className="import-popover__header"><div><p className="import-popover__eyebrow">クローゼットに追加</p><h2 className="import-popover__title" id="import-title">{readyCount ? `${readyCount}件 確認待ち` : activeStatus?.tone === "error" ? "確認が必要です" : jobs.length ? "新しい服を準備中" : notice?.text || "クローゼットに追加"}</h2></div><button className="import-icon-button" type="button" onClick={() => setOpen(false)} aria-label="閉じる"><X size={20} /></button></header>
          {!jobs.length ? setupRequired ? <div className="import-drop-target import-setup-warning"><WarningCircle size={30} /><h2>セットアップが必要です</h2><p><code>.env</code> に OpenAI API キーを入れ、自分の参考写真 PNG を <code>{setup.modelReference || "data/model-reference.png"}</code> に置いてから、アプリを再起動してください。</p></div> : <div className="import-drop-target"><UploadSimple size={28} /><h2>{notice ? "別の写真を試す" : "画像を選ぶ・貼り付ける"}</h2><p>{notice?.detail || "服をひとつずつ切り出して、詳細の候補を出して、あなたのOKを待ちます。"}</p><button className="import-button import-button--primary" disabled={!setup?.ready} onClick={() => { setNotice(null); inputRef.current?.click(); }}>画像を選ぶ</button></div> : (
            <>
              <div className={`import-progress${activeStatus?.tone !== "processing" ? " is-reviewing" : progress < 100 ? " is-indeterminate" : ""}`}><div className="import-progress__meta"><span>{activeStatus?.text}</span><span>{jobs.length} 件</span></div>{activeStatus?.tone === "processing" && <div className="import-progress__track"><div className="import-progress__bar" style={{ "--import-progress": `${progress}%` }} /></div>}</div>
              {reviewJob && reviewStage ? <ReviewEditor job={reviewJob} stage={reviewStage} draft={drafts[reviewJob.id] || defaultDraft(reviewJob)} setDraft={(draft) => setDrafts((current) => ({ ...current, [reviewJob.id]: draft }))} regenPrompt={regenerationPrompts[`${reviewJob.id}:${reviewStage}`] || ""} setRegenPrompt={(prompt) => setRegenerationPrompts((current) => ({ ...current, [`${reviewJob.id}:${reviewStage}`]: prompt }))} busy={busyId === reviewJob.id} onAction={(action, prompt) => perform(reviewJob, reviewStage, action, prompt)} /> : reviewJob && hasCleanupFailure(reviewJob) ? <CleanupEditor job={reviewJob} tolerance={cleanupTolerances[reviewJob.id] ?? reviewJob.stages.garment.cleanupTolerance ?? 46} setTolerance={(tolerance) => setCleanupTolerances((current) => ({ ...current, [reviewJob.id]: tolerance }))} busy={busyId === reviewJob.id} onPreview={(tolerance) => performCleanup(reviewJob, "preview", tolerance)} onAccept={() => performCleanup(reviewJob, "accept")} /> : null}
              <div className="import-card-list">{jobs.map((job) => { const status = deriveStatus(job); const itemName = drafts[job.id]?.name || job.metadata?.name || "新しい一着"; const failedStage = job.stages?.garment?.status === "failed" ? "garment" : job.stages?.modeled?.status === "failed" ? "modeled" : null; return <article className={`import-card is-${status.tone}${reviewJob?.id === job.id ? " is-selected" : ""}`} key={job.id}><img className="import-card__image" src={job.stages?.garment?.assetUrl || job.stages?.garment?.failedAssetUrl || job.stages?.crop?.assetUrl || job.originalAssetUrl} alt="" /><div className="import-card__body"><h3 className="import-card__title">{itemName}</h3><p className="import-card__detail import-card__detail--status" data-tone={status.tone}>{status.tone === "error" ? status.detail : status.text}</p></div><div className="import-card__actions">{status.tone === "ready" && <button className="import-icon-button" onClick={() => { setSelectedReviewId(job.id); setOpen(true); }} aria-label={`${itemName}を確認`}><Check size={17} /></button>}{failedStage && <button className="import-button import-card__retry" disabled={busyId === job.id} onClick={() => perform(job, failedStage, "regenerate", "")}><ArrowCounterClockwise size={14} /> 再試行</button>}<button className="import-icon-button import-card__delete" disabled={busyId === job.id} onClick={() => deleteJob(job)} aria-label={`${itemName}をキューから削除`}><Trash size={16} /></button></div></article>; })}</div>
              <div className="import-actions"><button className="import-button" onClick={() => inputRef.current?.click()}><Plus size={14} /> もう1枚追加</button></div>
            </>
          )}
          {error && <p className="import-status is-error" role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}
