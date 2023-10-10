diff --git a/source/texlive/texk/kpathsea/tex-file.c b/source/texlive/texk/kpathsea/tex-file.c
index 335f13b..6a0c65d 100644
--- a/source/texlive/texk/kpathsea/tex-file.c
+++ b/source/texlive/texk/kpathsea/tex-file.c
@@ -35,6 +35,13 @@
 #include <kpathsea/variable.h>
 #include <kpathsea/c-ctype.h>
 
+#if defined(BUILDING_WASM)
+#include <emscripten.h>
+EM_ASYNC_JS(void, kpathsea_find_file_generic__post_hook, (const_string path), {
+  await Module.kpathsea_find_file_generic__post_hook_js(UTF8ToString(path));
+});
+#endif
+
 /* These are not in the structure
    because it's annoying to initialize lists in C.  */
 #define GF_ENVS "GFFONTS", GLYPH_ENVS
@@ -1159,6 +1166,13 @@ kpathsea_find_file_generic (kpathsea kpse, const_string const_name,
     } 
   }
 #endif
+
+  #if defined(BUILDING_WASM)
+  if(ret && *ret){
+    //fprintf (stderr, "Calling JS: kpathsea_find_file_generic__post_hook('%s')\n", *ret);
+    kpathsea_find_file_generic__post_hook(*ret);
+  }
+  #endif
   return ret;
 }
 
