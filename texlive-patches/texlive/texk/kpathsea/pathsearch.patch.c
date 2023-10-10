diff --git a/source/texlive/texk/kpathsea/pathsearch.c b/source/texlive/texk/kpathsea/pathsearch.c
index 778b952..6b37ebf 100644
--- a/source/texlive/texk/kpathsea/pathsearch.c
+++ b/source/texlive/texk/kpathsea/pathsearch.c
@@ -31,6 +31,13 @@
 
 #include <time.h> /* for `time' */
 
+#if defined(BUILDING_WASM)
+#include <emscripten.h>
+EM_ASYNC_JS(void, kpathsea_search__post_hook, (const_string path), {
+  await Module.kpathsea_search__post_hook_js(UTF8ToString(path));
+});
+#endif
+
 #ifdef __DJGPP__
 #include <sys/stat.h>   /* for stat bits */
 #endif
@@ -599,6 +606,14 @@ search (kpathsea kpse, const_string path,  const_string original_name,
      list, since the path directories got unconditionally prepended.  */
   free (name);
 
+  #if defined(BUILDING_WASM)
+  for(int i = 0; i < ret_list.length; i++){
+    if(ret_list.list[i] && ret_list.list[i][0]){ //TODO
+      //fprintf (stderr, "Calling JS: kpathsea_search__post_hook('%s')\n", ret_list.list[i]);
+      kpathsea_search__post_hook(ret_list.list[i]);
+    }
+  }
+  #endif
   return STR_LIST (ret_list);
 }
 
