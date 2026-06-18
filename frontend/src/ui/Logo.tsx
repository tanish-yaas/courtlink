/** CourtLink wordmark + monogram. A minimal net-and-court glyph in gold. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <div className="brand">
      <svg className="brand__mark" viewBox="0 0 40 40" fill="none" aria-hidden>
        <rect x="1" y="1" width="38" height="38" rx="9" stroke="#C8A24B" strokeWidth="1.4" />
        <rect x="7" y="7" width="26" height="26" rx="4" stroke="#E4C97E" strokeWidth="1" opacity="0.5" />
        {/* net */}
        <line x1="20" y1="5" x2="20" y2="35" stroke="#F3EAD8" strokeWidth="1.2" />
        {/* kitchen lines */}
        <line x1="13" y1="7" x2="13" y2="33" stroke="#F3EAD8" strokeWidth="0.8" opacity="0.55" />
        <line x1="27" y1="7" x2="27" y2="33" stroke="#F3EAD8" strokeWidth="0.8" opacity="0.55" />
        {/* ball */}
        <circle cx="26" cy="14" r="2.4" fill="#D8F15B" />
      </svg>
      {withName && (
        <div>
          <div className="brand__name">
            Court<b>Link</b>
          </div>
          <div className="brand__tag">Pickleball Club</div>
        </div>
      )}
    </div>
  );
}
