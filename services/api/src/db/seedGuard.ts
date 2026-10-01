/** Development seed only. create-company does not call this. */
export function refuseProductionSeed(nodeEnv: string | undefined): void {
  if (nodeEnv === "production") {
    throw new Error("Refusing to run the development seed while NODE_ENV is production.");
  }
}
