export class MetaError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

type MetaResponse = { id?: string; status_code?: string; error?: { code?: number; error_subcode?: number } };

export class MetaClient {
  private readonly version: string;
  private readonly token: string;
  constructor(version: string, token: string) { this.version = version; this.token = token; }

  private async request(path: string, method: 'GET' | 'POST', params: Record<string, string>): Promise<MetaResponse> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    if (method === 'GET') url.search = new URLSearchParams(params).toString();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}` },
        body: method === 'POST' ? new URLSearchParams(params) : undefined,
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch { throw new MetaError('network_outcome_unknown'); }
    let data: MetaResponse;
    try { data = await response.json<MetaResponse>(); }
    catch { throw new MetaError('invalid_response_outcome_unknown'); }
    // Do not log API payloads: they may contain tokens or private account details.
    if (!response.ok || data.error) {
      throw new MetaError(`meta_${data.error?.code ?? response.status}_${data.error?.error_subcode ?? 0}`);
    }
    return data;
  }

  async publishFacebook(pageId: string, image: string, caption: string): Promise<string> {
    const data = await this.request(`${pageId}/photos`, 'POST', { url: image, caption, published: 'true' });
    if (!data.id) throw new MetaError('missing_id_outcome_unknown');
    return data.id;
  }

  async createInstagram(userId: string, image: string, caption: string): Promise<string> {
    const data = await this.request(`${userId}/media`, 'POST', { image_url: image, caption });
    if (!data.id) throw new MetaError('missing_container_id');
    return data.id;
  }

  async instagramStatus(id: string): Promise<string> {
    const data = await this.request(id, 'GET', { fields: 'status_code' });
    return data.status_code ?? 'UNKNOWN';
  }

  async publishInstagram(userId: string, containerId: string): Promise<string> {
    const data = await this.request(`${userId}/media_publish`, 'POST', { creation_id: containerId });
    if (!data.id) throw new MetaError('missing_id_outcome_unknown');
    return data.id;
  }
}
