import lguLogo from '../assets/LGU_LOGO.png';

export const LGU_NAME = 'Municipality of General Luna';

/**
 * LGU branding: seal on the left, name beside it.
 * size = "nav" (compact, for the Navbar) | "hero" (large, top of the Live Draw page)
 */
export default function Brand({ size = 'nav', subtitle }) {
  const Heading = size === 'hero' ? 'h1' : 'div';
  return (
    <div className={`brand brand-${size}`}>
      <img src={lguLogo} alt="Municipality of General Luna Logo" className="brand-logo" />
      <div className="brand-text">
        <Heading className="brand-title">{LGU_NAME}</Heading>
        {subtitle && <div className="brand-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}
