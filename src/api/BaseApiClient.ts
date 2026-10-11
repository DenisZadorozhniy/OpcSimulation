import { APIRequestContext, APIResponse } from '@playwright/test';

export class BaseApiClient {
  constructor(
    protected readonly request: APIRequestContext,
    protected readonly baseUrl: string,
  ) {}

  protected async get(path: string): Promise<APIResponse> {
    return this.request.get(new URL(path, this.baseUrl).toString());
  }

  protected async post(path: string, data: unknown): Promise<APIResponse> {
    return this.request.post(new URL(path, this.baseUrl).toString(), {
      data,
    });
  }

  protected async patch(path: string, data: unknown): Promise<APIResponse> {
    return this.request.patch(new URL(path, this.baseUrl).toString(), {
      data,
    });
  }

  protected async delete(path: string): Promise<APIResponse> {
    return this.request.delete(new URL(path, this.baseUrl).toString());
  }
}
