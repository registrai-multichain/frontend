import s from "./proposals.module.css";

/** The side column of the proposals pages (mockup: "How it works", the fee split, the tip). */
export function HowItWorks() {
  return (
    <aside className={s.aside}>
      <section className={s.panel} aria-labelledby="pp-how">
        <h2 id="pp-how" className={s.h2}>How it works</h2>
        <ol className={s.steps}>
          <li><b>You propose</b> the question, how it resolves, and the deadline.</li>
          <li><b>The team reviews it.</b> We may tighten the wording or deadline; you see the final version on its status page.</li>
          <li><b>Approved markets open</b> on Arc mainnet with a 5 USDC starting pool, signed by the team and opened by Registrai&#8217;s agent.</li>
          <li><b>You earn the creator share:</b> 30% of the market&#8217;s trading fees, forwarded to your wallet.</li>
        </ol>
      </section>
      <section className={s.panel} aria-labelledby="pp-fees">
        <h2 id="pp-fees" className={`${s.h2} ${s.h2Small}`}>Fees on every trade: 1%</h2>
        <div className={s.fees}>
          <div className={s.feeRow}><span>Creator (you)</span><span>30%</span></div>
          <div className={s.feeRow}><span>Settling agent</span><span>20%</span></div>
          <div className={s.feeRow}><span>Registrai treasury</span><span>50%</span></div>
        </div>
      </section>
      <div className={s.tip}>
        Good proposals have one clear answer, a public source anyone can check, and a deadline at least a day away.
      </div>
    </aside>
  );
}
