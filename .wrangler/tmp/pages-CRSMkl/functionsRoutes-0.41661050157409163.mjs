import { onRequestPost as __admin_auth_js_onRequestPost } from "D:\\مكاني سبوت v-4\\Makani-spot\\functions\\admin\\auth.js"
import { onRequest as __admin_listings_js_onRequest } from "D:\\مكاني سبوت v-4\\Makani-spot\\functions\\admin\\listings.js"
import { onRequestDelete as __delete_listing_js_onRequestDelete } from "D:\\مكاني سبوت v-4\\Makani-spot\\functions\\delete-listing.js"
import { onRequestOptions as __delete_listing_js_onRequestOptions } from "D:\\مكاني سبوت v-4\\Makani-spot\\functions\\delete-listing.js"
import { onRequestOptions as __upload_js_onRequestOptions } from "D:\\مكاني سبوت v-4\\Makani-spot\\functions\\upload.js"
import { onRequestPost as __upload_js_onRequestPost } from "D:\\مكاني سبوت v-4\\Makani-spot\\functions\\upload.js"

export const routes = [
    {
      routePath: "/admin/auth",
      mountPath: "/admin",
      method: "POST",
      middlewares: [],
      modules: [__admin_auth_js_onRequestPost],
    },
  {
      routePath: "/admin/listings",
      mountPath: "/admin",
      method: "",
      middlewares: [],
      modules: [__admin_listings_js_onRequest],
    },
  {
      routePath: "/delete-listing",
      mountPath: "/",
      method: "DELETE",
      middlewares: [],
      modules: [__delete_listing_js_onRequestDelete],
    },
  {
      routePath: "/delete-listing",
      mountPath: "/",
      method: "OPTIONS",
      middlewares: [],
      modules: [__delete_listing_js_onRequestOptions],
    },
  {
      routePath: "/upload",
      mountPath: "/",
      method: "OPTIONS",
      middlewares: [],
      modules: [__upload_js_onRequestOptions],
    },
  {
      routePath: "/upload",
      mountPath: "/",
      method: "POST",
      middlewares: [],
      modules: [__upload_js_onRequestPost],
    },
  ]