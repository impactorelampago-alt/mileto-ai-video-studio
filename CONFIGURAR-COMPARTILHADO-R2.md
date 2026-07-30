# Ativar o Compartilhado do Mileto AI Video

O aplicativo, o banco e a VPS já estão preparados. Falta somente criar o armazenamento na
conta Cloudflare e informar suas credenciais privadas.

## 1. Criar o bucket

1. Abra **Cloudflare → Storage & databases → R2 → Overview**.
2. Ative o R2 na conta, caso ainda não esteja ativo.
3. Crie um bucket privado. Nome sugerido: `mileto-ai-video-compartilhado`.

Documentação oficial: <https://developers.cloudflare.com/r2/get-started/s3/>

## 2. Criar a credencial

1. Em **R2 → Overview**, abra **Manage API Tokens**.
2. Crie um **Account API token**.
3. Selecione **Object Read & Write**.
4. Restrinja a credencial somente ao bucket criado acima.
5. Guarde estes três valores; o segredo é exibido apenas uma vez:
   - Account ID
   - Access Key ID
   - Secret Access Key

Documentação oficial: <https://developers.cloudflare.com/r2/api/tokens/>

## 3. Colocar na VPS e validar

Conecte-se à VPS e execute:

```bash
cd /opt/mileto-gateway
bash scripts/configure-r2.sh
```

O assistente pergunta os quatro dados, sem mostrar o segredo digitado. Em seguida ele:

- cria um backup protegido do `.env` atual;
- reinicia o gateway;
- envia, consulta e apaga um pequeno arquivo temporário;
- restaura automaticamente o `.env` anterior se a validação falhar.

Quando o teste terminar com `Cloudflare R2: leitura e gravação confirmadas`, a aba
**Compartilhado** estará pronta para upload, seleção de mídia, rascunhos da equipe e exportação.
