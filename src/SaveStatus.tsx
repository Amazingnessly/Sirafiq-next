type Props = {
  message: string;
  onDismiss: () => void;
};

export function SaveStatus({ message, onDismiss }: Props) {
  if (!message) return null;

  return <div
    role="alert"
    style={{
      position: 'fixed',
      zIndex: 50,
      left: '50%',
      bottom: '18px',
      width: 'min(620px, calc(100% - 24px))',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '14px',
      padding: '14px 16px',
      border: '1px solid rgba(116,29,37,.28)',
      borderRadius: '14px',
      background: '#fffaf4',
      color: '#671c23',
      boxShadow: '0 12px 36px rgba(76,44,28,.18)',
      fontSize: '14px',
      fontWeight: 600,
    }}
  >
    <span>{message}</span>
    <button type="button" onClick={onDismiss} style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700 }}>Fermer</button>
  </div>;
}
