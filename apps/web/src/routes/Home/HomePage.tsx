import { RoleHome } from "../../components/home/RoleHome";

/**
 * Landing page at /home. The chrome is the same for every job; only this
 * content changes (quality lead / admin, auditor, operator and everyone
 * else). Counts and charts stay on the Overview at "/".
 */
export function HomePage() {
  return <RoleHome />;
}
