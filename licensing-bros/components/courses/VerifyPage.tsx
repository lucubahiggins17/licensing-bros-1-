"use client";
// /verify/?code=  — public certificate check (works signed out).
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Check, Copy, Printer, RefreshCw, SearchX, ShieldCheck } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import { useParam, copyText } from "./courseData";
import Certificate, { verifyUrlFor, type CertificateData } from "./Certificate";
import s from "./Verify.module.css";

type Result =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; cert: CertificateData }
  | { status: "missing"; code: string }
  | { status: "error"; message: string };

const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function lookup(code: string): Promise<CertificateData | null> {
  const { data, error } = await supabase().rpc("verify_certificate", { p_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as CertificateData) || null;
}

export default function VerifyPage() {
  // Print just the certificate from this page
  useEffect(() => {
    document.documentElement.classList.add("lb-cert-print");
    return () => document.documentElement.classList.remove("lb-cert-print");
  }, []);
  return (
    <AppShell blueprint>
      <Suspense fallback={<Top input="" setInput={() => {}} onSubmit={(e) => e.preventDefault()} busy={false} fieldErr="" />}>
        <Verify />
      </Suspense>
    </AppShell>
  );
}

function Verify() {
  const router = useRouter();
  const qCode = normalize(useParam("code") || "");
  const [input, setInput] = useState(qCode);
  const [fieldErr, setFieldErr] = useState("");
  const [result, setResult] = useState<Result>({ status: "idle" });

  const check = useCallback(async (code: string) => {
    setResult({ status: "loading" });
    try {
      let cert = await lookup(code);
      // Codes only use 0-9 and A-F, so a typed letter O is almost always a zero
      if (!cert && code.includes("O")) cert = await lookup(code.replace(/O/g, "0"));
      setResult(cert ? { status: "found", cert } : { status: "missing", code });
    } catch {
      setResult({
        status: "error",
        message: typeof navigator !== "undefined" && !navigator.onLine ? "You're offline. Connect to the internet and try again." : "We couldn't check that code right now. Try again in a moment."
      });
    }
  }, []);

  useEffect(() => {
    setInput(qCode);
    if (qCode) check(qCode);
    else setResult({ status: "idle" });
  }, [qCode, check]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalize(input);
    if (!clean) { setFieldErr("Enter the code printed on the certificate."); return; }
    setFieldErr("");
    if (clean === qCode) check(clean);
    else router.replace(routes.verify(clean), { scroll: false });
    // The answer shows above the form once a code is in the link
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  // Someone opening a shared verification link wants the answer first; the form moves below.
  const resultsFirst = !!qCode;
  const top = (
    <Top compact={resultsFirst} input={input} setInput={(v) => { setInput(v); if (fieldErr) setFieldErr(""); }} onSubmit={submit} busy={result.status === "loading"} fieldErr={fieldErr} />
  );

  const results = (
      <section className={`${s.results} ${resultsFirst ? s.resultsFirst : ""}`} aria-live="polite" aria-busy={result.status === "loading"}>
        <div className={`wrap ${s.resultsWrap}`}>
          {resultsFirst && <h1 className={s.pageTitle}>Certificate check</h1>}
          {result.status === "idle" && (
            <p className={`${s.idle} ${s.noPrint}`}>Enter a certificate code above. The result shows here.</p>
          )}
          {result.status === "loading" && (
            <div className={`card ${s.loading}`}><span className="spin" aria-hidden="true" /> Checking our records…</div>
          )}
          {result.status === "found" && <Found cert={result.cert} />}
          {result.status === "missing" && (
            <div className={`card tape ${s.missing}`} role="alert">
              <SearchX className={s.missingIco} aria-hidden="true" />
              <div>
                <h2>No certificate with code <span className="mono">{result.code}</span></h2>
                <p>Double-check the code for typos. Codes are 10 characters long and use the numbers 0&ndash;9 and the letters A&ndash;F.</p>
                <p>If you&rsquo;re the student and just finished a course, open the course page and tap <b>Get your certificate</b>.</p>
              </div>
            </div>
          )}
          {result.status === "error" && (
            <div className={`card hard ${s.missing}`} role="alert">
              <div>
                <h2>Couldn&rsquo;t check right now</h2>
                <p>{result.message}</p>
                <button className="btn primary" onClick={() => qCode && check(qCode)}><RefreshCw aria-hidden="true" /> Try again</button>
              </div>
            </div>
          )}
        </div>
      </section>
  );

  return resultsFirst ? (
    <>{results}<div className={`hazard ${s.noPrint}`} />{top}</>
  ) : (
    <>{top}<div className={`hazard ${s.noPrint}`} />{results}</>
  );
}

function Top({ compact = false, input, setInput, onSubmit, busy, fieldErr }: { compact?: boolean; input: string; setInput: (v: string) => void; onSubmit: (e: React.FormEvent) => void; busy: boolean; fieldErr: string }) {
  return (
    <section className={`${s.top} ${s.noPrint}`}>
      <div className={`wrap ${s.topGrid}`}>
        <div className={s.intro}>
          {compact ? (
            <>
              <p className="eyebrow orange">Certificate check</p>
              <h2 className={s.againTitle}>Check another certificate</h2>
              <p className={s.lede}>Every Licensing Bro&rsquo;s certificate has its own code. Enter a different one to confirm it&rsquo;s real.</p>
            </>
          ) : (
            <>
              <div className={`plate orange ${s.plate}`}>
                <h1>Verify a certificate</h1>
                <p className={s.plateSub}>Certificate of completion check</p>
                <span className="bolts" />
              </div>
              <p className={s.lede}>
                Every Licensing Bro&rsquo;s certificate has its own code. Enter it here to confirm the certificate is real and see
                who earned it and when. No account needed.
              </p>
            </>
          )}
          <p className={s.trust}><ShieldCheck aria-hidden="true" /> Checked live against our records.</p>
        </div>
        <form className={`formcs ${s.form}`} onSubmit={onSubmit} aria-labelledby="vc1-title" noValidate>
          <div className="hazard" />
          <div className="formhead"><b id="vc1-title">Form VC-1 <span className={s.formName}>Certificate verification</span></b></div>
          <div className="formbody">
            <label className="field" htmlFor="vc1-code">
              <span className={s.step}><span className="stepnum">1</span>Certificate code</span>
              <input
                id="vc1-code"
                className={s.codeInput}
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="e.g. 7F3A9C21BD"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                aria-invalid={!!fieldErr}
                aria-describedby={fieldErr ? "vc1-err" : "vc1-hint"}
              />
              {fieldErr
                ? <span id="vc1-err" className={`hint ${s.fieldErr}`}>{fieldErr}</span>
                : <span id="vc1-hint" className="hint">It&rsquo;s printed at the bottom of the certificate.</span>}
            </label>
            <button type="submit" className="btn navy cta block big" disabled={busy}>
              {busy ? "Checking…" : <>Verify certificate <ArrowRight aria-hidden="true" /></>}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function Found({ cert }: { cert: CertificateData }) {
  const [copied, setCopied] = useState(false);
  const date = new Date(cert.issued_at);
  const when = isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <div className={s.found}>
      <div className={`${s.verified} ${s.noPrint}`} role="status">
        <BadgeCheck className={s.verifiedIco} aria-hidden="true" />
        <div>
          <b>Verified: this certificate is real</b>
          <p>Issued by Licensing Bro&rsquo;s to <strong>{cert.student_name}</strong>{when ? <> on {when}</> : null} for completing <strong>{cert.course_title}</strong>.</p>
        </div>
      </div>
      <Certificate cert={cert} />
      <div className={`row ${s.noPrint}`}>
        <button className="btn navy" onClick={() => window.print()}><Printer aria-hidden="true" /> Print or save as PDF</button>
        <button className="btn" onClick={async () => { if (await copyText(verifyUrlFor(cert.code))) { setCopied(true); setTimeout(() => setCopied(false), 2200); } }} aria-live="polite">
          {copied ? <><Check aria-hidden="true" /> Link copied</> : <><Copy aria-hidden="true" /> Copy link</>}
        </button>
        <Link className="btn ghost" href={routes.courses()}>Browse courses</Link>
      </div>
    </div>
  );
}
