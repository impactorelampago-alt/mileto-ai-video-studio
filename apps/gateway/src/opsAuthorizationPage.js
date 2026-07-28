const escapeHtml = (value) =>
    String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

export const maskEmailHint = (value) => {
    const email = String(value || '').trim().toLowerCase();
    const separator = email.lastIndexOf('@');
    if (separator <= 0) return '';
    const local = email.slice(0, separator);
    const domain = email.slice(separator + 1);
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'•'.repeat(Math.max(3, Math.min(7, local.length - visible.length)))}@${domain}`;
};

const icon = (kind) => {
    if (kind === 'success') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5"/></svg>';
    }
    if (kind === 'mismatch') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.2c0 4.8 3.2 8.5 7.5 9.8 4.3-1.3 7.5-5 7.5-9.8V6L12 3Z"/><path d="m9.5 9.5 5 5m0-5-5 5"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3.5v.1"/><path d="M10.2 4.3 2.8 17.1A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.9L13.8 4.3a2 2 0 0 0-3.6 0Z"/></svg>';
};

export const renderOpsAuthorizationPage = ({
    kind = 'error',
    eyebrow,
    title,
    message,
    organizationName = '',
    accountName = '',
    expectedEmailHint = '',
    actionUrl = '',
}) => {
    const safeKind = ['success', 'mismatch', 'error'].includes(kind) ? kind : 'error';
    const safeActionUrl = actionUrl ? escapeHtml(actionUrl) : '';
    const showComparison = safeKind === 'mismatch' && (organizationName || accountName);

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--accent:${safeKind === 'success' ? '#28e38d' : safeKind === 'mismatch' ? '#fb7185' : '#f59e0b'};--accent2:${safeKind === 'success' ? '#18bca4' : safeKind === 'mismatch' ? '#f59e0b' : '#fb7185'};--ink:#f7faf9;--muted:#91a09b;--panel:#0b1110}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0}body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#050807;overflow-x:hidden}
    body:before,body:after{content:"";position:fixed;border-radius:999px;filter:blur(90px);pointer-events:none;opacity:.18}body:before{width:520px;height:520px;left:-210px;top:-210px;background:var(--accent)}body:after{width:460px;height:460px;right:-180px;bottom:-220px;background:var(--accent2)}
    .grid{position:fixed;inset:0;pointer-events:none;opacity:.22;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,black,transparent 88%)}
    main{position:relative;z-index:1;min-height:100vh;display:grid;place-items:center;padding:34px 20px}.wrap{width:min(680px,100%)}
    .brands{display:flex;align-items:center;justify-content:center;gap:13px;margin-bottom:24px;color:#9aa6a2;font-size:13px;font-weight:700;letter-spacing:.02em}.brand-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.035);color:#39e69a;box-shadow:inset 0 1px rgba(255,255,255,.05)}.brand-mark.video{color:#a78bfa}.brand-mark svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2}.bridge{width:38px;height:1px;background:linear-gradient(90deg,#24d88a,#8b5cf6)}
    .card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.09);border-radius:30px;background:linear-gradient(145deg,rgba(15,22,20,.98),rgba(7,11,10,.98));box-shadow:0 34px 100px rgba(0,0,0,.55),inset 0 1px rgba(255,255,255,.035)}.card:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);opacity:.8}
    .hero{padding:38px 40px 30px;border-bottom:1px solid rgba(255,255,255,.065);background:radial-gradient(circle at 12% 0,rgba(255,255,255,.045),transparent 42%)}
    .status{display:grid;place-items:center;width:58px;height:58px;border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);border-radius:19px;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);box-shadow:0 0 38px color-mix(in srgb,var(--accent) 14%,transparent)}.status svg{width:29px;height:29px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .eyebrow{margin-top:22px;color:var(--accent);font-size:10px;font-weight:900;letter-spacing:.19em;text-transform:uppercase}.hero h1{max-width:570px;margin:10px 0 0;font-size:clamp(27px,5vw,40px);line-height:1.07;letter-spacing:-.04em}.hero p{max-width:560px;margin:15px 0 0;color:var(--muted);font-size:15px;line-height:1.7}
    .content{padding:28px 40px 36px}.compare{display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:12px}.fact{padding:16px;border:1px solid rgba(255,255,255,.07);border-radius:17px;background:rgba(255,255,255,.025)}.fact small{display:block;color:#71817b;font-size:9px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.fact strong{display:block;margin-top:7px;font-size:14px;line-height:1.35}.fact span{display:block;margin-top:5px;color:#7f908a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}.arrow{display:grid;place-items:center;color:#52605b;font-size:18px}
    .guide{margin-top:20px;padding:18px;border:1px solid color-mix(in srgb,var(--accent) 16%,transparent);border-radius:17px;background:color-mix(in srgb,var(--accent) 5%,transparent)}.guide-title{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:800}.guide-title i{display:grid;place-items:center;width:22px;height:22px;border-radius:8px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);font-style:normal}.steps{display:grid;gap:10px;margin:14px 0 0;padding:0;list-style:none}.steps li{display:flex;gap:10px;color:#9aa8a3;font-size:12px;line-height:1.5}.steps b{display:grid;place-items:center;flex:0 0 20px;height:20px;border:1px solid rgba(255,255,255,.09);border-radius:7px;color:#d7dfdc;font-size:9px}
    .actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:24px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#08100d;text-decoration:none;font-size:13px;font-weight:900;box-shadow:0 12px 30px color-mix(in srgb,var(--accent) 17%,transparent);transition:transform .18s ease,filter .18s ease}.button:hover{transform:translateY(-1px);filter:brightness(1.08)}.close-note{color:#687771;font-size:11px;line-height:1.5}
    @media(max-width:620px){.hero,.content{padding-left:23px;padding-right:23px}.compare{grid-template-columns:1fr}.arrow{transform:rotate(90deg);height:16px}.brands{font-size:11px}.bridge{width:20px}}
  </style>
</head>
<body>
  <div class="grid"></div>
  <main>
    <div class="wrap">
      <div class="brands">
        <span class="brand-mark"><svg viewBox="0 0 24 24"><path d="M4 12h16M12 4v16"/></svg></span><span>Mileto Ops</span><i class="bridge"></i><span class="brand-mark video"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg></span><span>Mileto AI Video</span>
      </div>
      <section class="card">
        <div class="hero">
          <div class="status">${icon(safeKind)}</div>
          <div class="eyebrow">${escapeHtml(eyebrow)}</div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(message)}</p>
        </div>
        <div class="content">
          ${showComparison ? `<div class="compare"><div class="fact"><small>Empresa no AI Video</small><strong>${escapeHtml(organizationName || 'Empresa atual')}</strong>${expectedEmailHint ? `<span>Dono: ${escapeHtml(expectedEmailHint)}</span>` : ''}</div><div class="arrow">→</div><div class="fact"><small>Conta aberta no Ops</small><strong>${escapeHtml(accountName || 'Outra conta')}</strong><span>Não corresponde ao dono esperado</span></div></div>` : ''}
          ${safeKind === 'mismatch' ? '<div class="guide"><div class="guide-title"><i>!</i>Como resolver</div><ol class="steps"><li><b>1</b><span>Saia da conta que está aberta no Mileto Ops.</span></li><li><b>2</b><span>Entre com a conta do dono da empresa indicada acima.</span></li><li><b>3</b><span>Volte ao AI Video e clique em “Abrir autorização novamente”.</span></li></ol></div>' : ''}
          <div class="actions">${safeActionUrl ? `<a class="button" href="${safeActionUrl}">${safeKind === 'mismatch' ? 'Trocar conta no Mileto Ops' : 'Abrir Mileto Ops'}</a>` : ''}<span class="close-note">Você pode fechar esta aba e voltar ao Mileto AI Video.</span></div>
        </div>
      </section>
    </div>
  </main>
</body>
</html>`;
};
