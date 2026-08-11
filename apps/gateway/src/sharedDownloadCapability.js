const cleanAttachmentName = (value) => {
    const name = String(value || '')
        .split('')
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
        .slice(0, 180);
    return name && name !== '.' && name !== '..' ? name : 'arquivo-mileto';
};

const encodeRfc5987 = (value) => encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
);

export const sharedDownloadContentDisposition = (value) => {
    const utf8Name = cleanAttachmentName(value);
    const asciiName = utf8Name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7e]/g, '_')
        .replace(/["\\]/g, '_')
        .trim() || 'arquivo-mileto';
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(utf8Name)}`;
};
