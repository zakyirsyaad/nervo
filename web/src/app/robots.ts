import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

/** Every page is public; the sitemap lists them. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
