"use client";
// Certificate of Completion. Used on the course page (after claiming) and on /verify/.
import { Award } from "lucide-react";
import { asset, routes, SITE_URL } from "@/lib/nav";
import { publicOrigin } from "./courseData";
import s from "./Certificate.module.css";

export type CertificateData = { code: string; student_name: string; course_title: string; issued_at: string };

export function verifyUrlFor(code: string): string {
  return `${publicOrigin(SITE_URL)}${routes.verify(code)}`;
}

export default function Certificate({ cert }: { cert: CertificateData }) {
  const date = (() => {
    const d = new Date(cert.issued_at);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  })();
  const url = verifyUrlFor(cert.code);

  return (
    <figure className={s.cert} aria-label={`Certificate of completion: ${cert.student_name}, ${cert.course_title}`}>
      <div className={s.frame}>
        <div className={s.inner}>
          <span className={`${s.corner} ${s.tl}`} aria-hidden="true" />
          <span className={`${s.corner} ${s.tr}`} aria-hidden="true" />
          <span className={`${s.corner} ${s.bl}`} aria-hidden="true" />
          <span className={`${s.corner} ${s.br}`} aria-hidden="true" />

          <img className={s.logo} src={asset("/logo.png")} alt="Licensing Bro's" width={640} height={481} />
          <p className={s.kicker}>Licensing Bro&rsquo;s &middot; Contractor Exam Prep</p>
          <h2 className={s.title}>Certificate <span>of Completion</span></h2>
          <div className={s.tape} aria-hidden="true" />
          <p className={s.lead}>This certifies that</p>
          <p className={s.name}>{cert.student_name}</p>
          <p className={s.lead}>has successfully completed the course</p>
          <p className={s.course}>{cert.course_title}</p>

          <div className={s.foot}>
            <div className={s.field}>
              <span>Date issued</span>
              <b>{date}</b>
            </div>
            <div className={s.seal} aria-hidden="true">
              <Award />
              <span>Verified</span>
            </div>
            <div className={s.field}>
              <span>Certificate code</span>
              <b className={s.code}>{cert.code}</b>
            </div>
          </div>
          <p className={s.verify}>Verify at <span>{url}</span></p>
        </div>
      </div>
    </figure>
  );
}
