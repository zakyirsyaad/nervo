import type { MetadataRoute } from "next";
import { SITE_PATHS, SITE_URL } from "@/config/site";

/** The four pages of the site, on the production domain. No lastModified: it would change on every build. */
export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_PATHS.map((path) => ({ url: path === "/" ? SITE_URL : `${SITE_URL}${path}` }));
}
