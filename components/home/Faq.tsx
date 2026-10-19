"use client";
// Frequently asked questions (native <details> accordion: keyboard and screen-reader friendly).
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePlanLimits } from "./Plans";
import s from "./Home.module.css";

export default function Faq() {
  const { settings } = useAuth();
  const { free, paid } = usePlanLimits();
  const radius = settings.location_rules?.home_radius_miles ?? 100;
  const enforce = settings.location_rules?.enforce !== false;
  const email = settings.support?.email?.trim();
  const phone = settings.support?.phone?.trim();

  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: "Is it really free to start?",
      a: <>Yes. A free account gets you the free courses, free live classes, the community, {free.ai_daily} AI tutor questions a day and practice exams up to {free.exam_max_questions} questions. No card needed.</>
    },
    {
      q: "What do I get when I buy a course?",
      a: <>Every lesson in that course, the live classes that go with it, and Pro study tools: {paid.ai_daily} AI questions a day and practice exams up to {paid.exam_max_questions} questions{paid.ai_exams ? ", plus AI-built mock exams" : ""}.</>
    },
    {
      q: "Which trades and states do you cover?",
      a: <>General contractor, electrical, plumbing and HVAC, in all 50 states and DC. Use the course finder above to see the courses for your state and trade.</>
    },
    {
      q: "Are these the real exam questions?",
      a: <>No. Practice questions teach the concepts that get tested; they are not actual exam items. Licensing Bro&rsquo;s is an independent study tool and isn&rsquo;t affiliated with PSI, Prometric, NASCLA, the ICC, NFPA or any state licensing board.</>
    },
    {
      q: "How does the AI tutor know my state's rules?",
      a: <>Some rules change from state to state, like license law, lien deadlines and which code edition is used. For those questions Bro checks the rule for your state and lists where the answer came from, so you can confirm it in your book.</>
    },
    {
      q: "Why can I only use one device at a time?",
      a: <>It keeps accounts from being shared, which protects what you paid for. If you open your account on a new phone or computer, you can move it there with one tap.{enforce && <> Paid lessons also play within about {radius} miles of your home area; when you travel for work, turn on Travel mode in your account.</>}</>
    },
    {
      q: "Does it work on my phone? What about with no signal?",
      a: <>Yes. Everything is built for phones first. Practice exams, games and calculators keep working without a signal; the AI tutor and videos need internet.</>
    },
    {
      q: "How do I get help?",
      a: email || phone
        ? <>Reach the team {email && <>at <a href={`mailto:${email}`}>{email}</a></>}{email && phone && " or "}{phone && <>by phone at <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></>}. You can also post a question in the community.</>
        : <>Post a question in the community and the team or another student will help you out.</>
    }
  ];

  return (
    <section className={s.faqSection} aria-labelledby="faq-title">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow orange">Questions</span>
          <h2 id="faq-title">Straight answers</h2>
        </div>
        <div className={s.faq}>
          {items.map((it) => (
            <details key={it.q} className={s.qa}>
              <summary>
                <span>{it.q}</span>
                <span className={s.plus} aria-hidden="true"><Plus /></span>
              </summary>
              <div className={s.answer}>{it.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
