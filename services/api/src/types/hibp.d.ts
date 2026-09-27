declare module "hibp" {
  export function pwnedPassword(
    password: string,
    options?: { addPadding?: boolean; timeoutMs?: number },
  ): Promise<number>;
}
