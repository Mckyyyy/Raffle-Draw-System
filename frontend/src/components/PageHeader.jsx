import lguLogo from '../assets/LGU_LOGO.png';
import { LGU_NAME } from './Brand.jsx';

/**
 * Shared page header in the Live Draw style: small seal, LGU name in gold
 * small-caps, serif title, thin gold rule, optional right-hand slot.
 */
export default function PageHeader({ title, subtitle, right, compact = false }) {
  return (
    <header className={`pg-head ${compact ? 'compact' : ''}`}>
      <div className="pg-head-main">
        <img src={lguLogo} alt="Municipality of General Luna Logo" className="pg-seal" />
        <div>
          <div className="pg-lgu">{LGU_NAME}</div>
          <h1 className="pg-title">{title}</h1>
          {subtitle && <p className="pg-subtitle">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="pg-head-right">{right}</div>}
      <div className="pg-rule" aria-hidden="true" />
    </header>
  );
}
