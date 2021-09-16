//TODO: what happens if creating another pipeline (waiting data error?)
//TODO: put texlive into /opt/texlive/2020 or ~/.texlive2020?
//TODO: configure fontconfig to use /etc/fonts

class BusytexDataPackageResolver
{
    constructor(data_packages_js, texmf_system = [], texmf_local = [], remap = {
            config : null,
            firstaid : 'latex-firstaid', 
            hyphen : null,
            jknapltx : null,
            latexconfig : null,
            pdfwin : null,
            plweb : 'pl',
            symbol : null,
            syntax : null,
            third : null,
            twoup : null,
            zapfding : null
        })
    {
        this.regex_createPath = /"filename": "(.+?)"/g 
        this.regex_usepackage = /\\usepackage(\[.*?\])?\{(.+?)\}/g;
        this.regex_providespackage = /\\ProvidesPackage(\[.*?\])?\{(.+?)\}/g;
        this.basename = path => path.slice(path.lastIndexOf('/') + 1);
        this.dirname = path => path.slice(0, path.lastIndexOf('/'));
        this.isfile = path => this.basename(path).includes('.');
        
        this.msgs = [];
        this.data_packages_js = data_packages_js;
        this.data_packages = data_packages_js.map(data_package_js => [data_package_js, fetch(data_package_js).then(r => r.text()).then(data_package_js_script => new Set(Array.from(data_package_js_script.matchAll(this.regex_createPath)).map(groups => this.extract_tex_package_name(groups[1])).filter(f => f)  )    )]);
        this.remap = remap;
        this.texmf_local_texmfdist_tex  = texmf_local .map(t => t + '/texmf-dist/tex/');
        this.texmf_system_texmfdist_tex = texmf_system.map(t => t + '/texmf-dist/tex/');
        this.texmf_texmfdist_tex = [...this.texmf_system_texmfdist_tex, ...this.texmf_local_texmfdist_tex];
        this.data_packages_cache = null;
    }

    async resolve_data_packages()
    {
        const values = await Promise.all(this.data_packages.map(([k, v]) => v));
        return this.data_packages.map(([k, v], i) => [k, Array.from(values[i]).sort()]);
    }

    cache_data_packages()
    {
        if(!this.data_packages_cache)
            this.data_packages_cache = Promise.all(this.data_packages_js.map(data_package_js => fetch(data_package_js.replace('.js', '.data'), {mode : 'no-cors'})));
    }
    
    extract_tex_package_name(path, contents = '')
    {
        // implicitly excludes /.../temxf-dist/{fonts,bibtex}
        // cat urls.txt | while read URL; do echo $(curl -sI ${URL%$'\r'} | head -n 1 | cut -d' ' -f2) $URL; done | grep 404 | sort | uniq

        // https://ctan.org/tex-archive/macros/latex/required/graphics, graphicx

        const splitrootdir = path => { const splitted = path.split('/'); return [splitted[0], splitted.slice(1).join('/') ]; };

        if(!path.endsWith('.sty'))
            return null;

        const basename = this.basename(path);
        let tex_package_name = basename.slice(0, basename.length - '.sty'.length);
        if(this.isfile(path))
        {
            const prefix = this.texmf_texmfdist_tex.find(t => path.startsWith(t));
            if(contents)
            {
                const tex_packages = contents.split('\n').filter(l => l.trim().startsWith('\\ProvidesPackage')).map(l => Array.from(l.matchAll(this.regex_providespackage)).filter(groups => groups.length >= 2).map(groups => groups.pop()  )  ).flat();
                if(tex_packages.length > 0)
                    tex_package_name = tex_packages[0];
            }
            else if(prefix)
            {
                tex_package_name = splitrootdir(splitrootdir(path.slice(prefix.length))[1])[0];
                this.msgs.push([tex_package_name, path, 'https://ctan.org/pkg/' + tex_package_name]);

                if(tex_package_name in this.remap)
                    tex_package_name = this.remap[tex_package_name];
            }
        }

        return tex_package_name;
    }
    
    async resolve(files, main_tex_path, data_packages_js = null)
    {
        const tex_packages = files.filter(f => typeof(f.contents) == 'string' && f.path == main_tex_path).map(f => f.contents.split('\n').filter(l => l.trim().startsWith('\\usepackage')).map(l => Array.from(l.matchAll(this.regex_usepackage)).filter(groups => groups.length >= 2).map(groups => groups.pop().split(',')  )  )).flat().flat().flat();
        
        const tex_packages_local = new Set(files.filter(f => this.texmf_local_texmfdist_tex.some(t => f.path.startsWith(t)) || f.path.endsWith('.sty')).map(f => this.extract_tex_package_name(f.path, typeof(f.contents) == 'string' ? f.contents : '')).filter(f => f));
        
        const tex_packages_to_resolve = tex_packages.filter(tex_package => !tex_packages_local.has(tex_package));

        const resolved = Object.fromEntries(tex_packages.map(tex_package => ([tex_package, {used: true, source : null}])));
        for(const tex_package of tex_packages_local)
        {
            resolved[tex_package] = resolved[tex_package] || {};
            resolved[tex_package].source = 'local';
            resolved[tex_package].used = resolved[tex_package].used || false;
        }
        
        let update_data_packages_js = false;
        const tex_packages_not_resolved = [];
        let data_packages = [];
        
        if(data_packages_js === null)
        {
            update_data_packages_js = true;
            data_packages = this.data_packages;
            data_packages_js = new Set();
        }
        else
        {
            update_data_packages_js = false;
            data_packages = this.data_packages.filter(([data_package_js, tex_packages]) => data_packages_js.includes(data_package_js));
        }

        for(const tex_package of tex_packages_to_resolve)
        {
            for(const [data_package_js, tex_packages] of [...data_packages, [null, null]])
            {
                if(tex_packages !== null && (await tex_packages).has(tex_package))
                {
                    resolved[tex_package].source = data_package_js;

                    if(update_data_packages_js)
                        data_packages_js.add(data_package_js);
                    break;
                }
            }
        }

        return resolved;
    }
}


class BusytexBibtexResolver
{
    resolve (files, bib_tex_commands = ['\\bibliography', '\\printbibliography'])
    {
        return files.some(f => f.path.endsWith('.tex') && typeof(f.contents) == 'string' && bib_tex_commands.some(b => f.contents.includes(b)));
        // files.some(({path, contents}) => contents != null && path.endsWith('.bib'));
    }
}

class BusytexPipeline
{
    static texmf_system = ['/texlive', '/texmf'];
    static VerboseSilent = 'silent';
    static VerboseInfo = 'info';
    static VerboseDebug = 'debug';

    //FIXME begin: have to do static to execute LZ4 data packages: https://github.com/emscripten-core/emscripten/issues/12347
    static preRun = [];
    static calledRun = false;
    static data_packages = [];
    static locateFile(remote_package_name) 
    {
        return BusytexPipeline.data_packages.map(data_package_js => data_package_js.replace('.js', '.data')).find(data_file => data_file.endsWith(remote_package_name));
    }
    //FIXME end

    static ScriptLoaderDocument(src)
    {
        return new Promise((resolve, reject) =>
        {
            let s = self.document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            self.document.head.appendChild(s);
        });
    }

    static ScriptLoaderRequire(src)
    {
        return new Promise(resolve => self.require([src], resolve));
    }

    static ScriptLoaderWorker(src)
    {
        return Promise.resolve(self.importScripts(src));
    }

    load_package(data_package_js)
    {
        if(data_package_js in this.data_package_promises)
            return this.data_package_promises[data_package_js];

        BusytexPipeline.calledRun = false;
        BusytexPipeline.data_packages.push(data_package_js);
        const promise = this.script_loader(data_package_js);
        this.data_package_promises[data_package_js] = promise;
        return promise;
    }

    constructor(busytex_js, busytex_wasm, data_packages_js, preload_data_packages_js, texmf_local, print, on_initialized, preload, script_loader)
    {
        this.print = print;
        this.preload = preload;
        this.script_loader = script_loader;
        
        this.ansi_reset_sequence = '\x1bc';
        
        this.project_dir = '/home/web_user/project_dir';
        this.bin_busytex = '/bin/busytex';
        this.fmt = {
            pdftex : '/texlive/texmf-dist/texmf-var/web2c/pdftex/pdftex.fmt',
            xetex:   '/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt',
            luatex:  '/texlive/texmf-dist/texmf-var/web2c/luahbtex/lualatex.fmt',
//          xetex  : '/xelatex.fmt', 
//          luatex : '/lualatex.fmt'
        };
        this.dir_texmfdist = [...BusytexPipeline.texmf_system, ...texmf_local].map(texmf => texmf + '/texmf-dist').join(':');
        this.dir_texmfvar = '/texlive/texmf-dist/texmf-var';
        this.dir_cnf = '/texlive/texmf-dist/web2c';
        this.dir_fontconfig = '/etc/fonts';
        this.texmflog = '/tmp/texmf.log';

        this.verbose_args = 
        {
            [BusytexPipeline.VerboseSilent] : {
                pdftex : [],
                xetex : [],
                luatex : [],
                bibtex8 : [],
                xdvipdfmx : [],
            },
            [BusytexPipeline.VerboseInfo] : {
                pdftex: ['-kpathsea-debug', '32'],
                xetex: ['-kpathsea-debug', '32'],
                luatex: ['-kpathsea-debug', '32'],
                bibtex8 : ['--debug', 'search'],
                xdvipdfmx : ['-v', '--kpathsea-debug', '32'],
            },
            [BusytexPipeline.VerboseDebug] : {
                pdftex : ['-kpathsea-debug', '63', '-recorder'],
                xetex : ['-kpathsea-debug', '63', '-recorder'],
                luatex : ['-kpathsea-debug', '63', '-recorder', '--debug-format'],
                bibtex8 : ['--debug', 'all'],
                xdvipdfmx : ['-vv', '--kpathsea-debug', '63'],
            },
        };
        this.supported_drivers = ['xetex_bibtex8_dvipdfmx', 'pdftex_bibtex8', 'luatex_bibtex8'];
        this.error_messages = ['==> Fatal error occurred', 'no output PDF file produced', 'No pages of output.'];

        this.mem_header_size = 2 ** 26;
        this.env = {
            TEXMFDIST : this.dir_texmfdist, 
            TEXMFVAR : this.dir_texmfvar, 
            TEXMFCNF : this.dir_cnf, 
            TEXMFLOG : this.texmflog, 
            FONTCONFIG_PATH : this.dir_fontconfig
        };
        
        this.remove = (FS, log_path) => FS.analyzePath(log_path).exists ? FS.unlink(log_path) : null;
        this.read_all_text = (FS, log_path) => FS.analyzePath(log_path).exists ? FS.readFile(log_path, {encoding : 'utf8'}).trim() : '';
        this.read_all_bytes = (FS, pdf_path) =>FS.analyzePath(pdf_path).exists ? FS.readFile(pdf_path, {encoding: 'binary'}) : null;
        this.mkdir_p = (FS, PATH, dirpath, dirs = new Set()) =>
        {
            if(!dirs.has(dirpath))
            {
                this.mkdir_p(FS, PATH, PATH.dirname(dirpath), dirs);
                FS.mkdir(dirpath);
                dirs.add(dirpath);
            }
        };
        
        this.bibtex_resolver = new BusytexBibtexResolver();
        this.data_package_resolver = new BusytexDataPackageResolver(data_packages_js, BusytexPipeline.texmf_system, texmf_local);
        this.wasm_module_promise = fetch(busytex_wasm).then(WebAssembly.compileStreaming);
        this.em_module_promise = this.script_loader(busytex_js);
        BusytexPipeline.data_packages = [];
        this.data_package_promises = {};
        this.preload_data_packages_js = preload_data_packages_js;
        for(const data_package_js of this.preload_data_packages_js)
            this.load_package(data_package_js); 
        this.Module = this.reload_module_if_needed(this.preload !== false, this.env, this.project_dir, this.preload_data_packages_js);
        
        this.on_initialized = null;
        this.on_initialized_promise = new Promise(resolve => (this.on_initialized = resolve));
        this.on_initialized_promise_notification = this.on_initialized_promise.then(on_initialized);
    }

    terminate()
    {
        this.Module = null;
    }

    async reload_module_if_needed(cond, env, project_dir, data_packages_js)
    {
        if(cond)
        {
            return this.reload_module(env, project_dir, data_packages_js, true);
        }
        else if(this.Module)
        {
            const Module = await this.Module;
            const enabled_packages_js = Module.data_packages_js;
            const new_data_packages_js = data_packages_js.filter(data_package_js => !enabled_packages_js.includes(data_package_js));
           
            if(new_data_packages_js.length > 0)
            {
                return this.reload_module(env, project_dir, Array.from(enabled_packages_js).concat(Array.from(new_data_packages_js)), false);
            }

            return Module;
        }
    }

    async reload_module(env, project_dir, data_packages_js = [], report_applet_versions = false)
    {
        const data_packages_js_promise = data_packages_js.map(data_package_js => this.load_package(data_package_js));
        const [em_module, wasm_module] = await Promise.all([this.em_module_promise, WebAssembly.compileStreaming ? this.wasm_module_promise : this.wasm_module_promise.then(r => r.arrayBuffer()),  ...data_packages_js_promise]);
        const {print, init_env} = this;
        
        const pre_run_packages = Module => () =>
        {
            Object.setPrototypeOf(BusytexPipeline, Module);

            for(const preRun of BusytexPipeline.preRun)
            {
                if(Module.preRuns.includes(preRun))
                    continue;

                preRun();
                Module.preRuns.push(preRun);
            }
        }
        
        const Module =
        {
            thisProgram : this.bin_busytex,
            noInitialRun : true,
            totalDependencies: 0,
            prefix : '',
            preRuns : [],
            data_packages_js : data_packages_js,
            pre_run_packages : pre_run_packages,
            
            preRun : [() => { Object.assign(Module.ENV, env); Module.FS.mkdir(project_dir); self.LZ4 = Module.LZ4; }, () => pre_run_packages(Module)()],

            instantiateWasm(imports, successCallback)
            {
                WebAssembly.instantiate(wasm_module, imports).then(output => successCallback(WebAssembly.compileStreaming ? output : output.instance)).catch(err => {throw new Error('Error while initializing BusyTex!\n\n' + err.toString())});
                return {};
            },

            do_print : true,
            output_stdout : '',
            print(text)
            {
                text = (arguments.length > 1 ?  Array.prototype.slice.call(arguments).join(' ') : text) || '';
                Module.output_stdout += text + '\n' ;
                if(Module.do_print)
                    Module.setStatus(Module.thisProgram + ' stdout: ' + text);
            },
            output_stderr : '',
            printErr(text)
            {
                text = (arguments.length > 1 ?  Array.prototype.slice.call(arguments).join(' ') : text) || '';
                Module.output_stderr += text + '\n';
                Module.setStatus(Module.thisProgram + ' stderr: ' + text);
            },
            
            setPrefix(text)
            {
                this.prefix = text;
            },
            
            setStatus(text)
            {
                if(this.do_print)
                    print(text);
            },

            monitorRunDependencies(left)
            {
                this.totalDependencies = Math.max(this.totalDependencies, left);
                Module.setStatus(left ? 'Preparing... (' + (this.totalDependencies-left) + '/' + this.totalDependencies + ')' : 'All downloads complete.');
            },

            callMainWithRedirects(args = [], print = false) 
            {
                const Module = this;
                Module.do_print = print;
                Module.output_stdout = '';
                Module.output_stderr = '';
                Module.setPrefix(args[0]);
                
                const exit_code = Module.callMain(args);
                Module._flush_streams();
                
                return { exit_code : exit_code, stdout : Module.output_stdout, stderr : Module.output_stderr };
            }
        };
        
        const initialized_module = await busytex(Module);
        
        if(!(this.mem_header_size % 4 == 0 && initialized_module.HEAP32.slice(this.mem_header_size / 4).every(x => x == 0)))
            throw new Error(`Memory header size [${this.mem_header_size}] must be divisible by 4, and remaining memory must be zero`);
        
        if(report_applet_versions)
        {
            const applets = initialized_module.callMainWithRedirects().stdout.split('\n').filter(line => line.length > 0).filter(applet => applet != 'makeindex');
            initialized_module.applet_versions = Object.fromEntries(applets.map(applet => ([applet, initialized_module.callMainWithRedirects([applet, '--version']).stdout])));
            // TODO: exception here not caught?
            this.on_initialized(initialized_module.applet_versions);
        }
        else
            initialized_module.applet_versions = {};

        return initialized_module;
    }

    async compile(files, main_tex_path, bibtex, verbose, driver, data_packages_js = [])
    {
        if(!this.supported_drivers.includes(driver))
            throw new Error(`Driver [${driver}] is not supported, only [${this.supported_drivers}] are supported`);
        //this.print(this.ansi_reset_sequence);
        this.print(`New compilation started: [${main_tex_path}]`);
        
        if(bibtex === null)
            bibtex = this.bibtex_resolver.resolve(files);

        const resolved = await this.data_package_resolver.resolve(files, main_tex_path, data_packages_js);
        const filter_map = (f, return_tex_package = true) => Object.entries(resolved).filter(([tex_package, v]) => f(v)).map(([tex_package, v]) => return_tex_package ? tex_package : v.source);

        data_packages_js = Array.from(new Set(filter_map(v => v.used && v.source != 'local' && v.source != null, false))).sort();
        
        const tex_packages_not_resolved = filter_map(v => v.source == null);
        
        console.log('RESOLVED', resolved, this.preload_data_packages_js);

        this.print('TeX packages: ' + filter_map(v => v.used).toString());
        this.print('TeX packages local: ' + filter_map(v => v.source == 'local').toString());
        this.print('TeX packages unresolved (in local or preloaded): ' + filter_map(v => v.used && (v.source != 'local' && !this.preload_data_packages_js.includes(v.source))).toString());
        this.print('TeX packages unresolved: ' + tex_packages_not_resolved.toString());
        this.print('Data packages used (not preloaded): ' + Array.from(new Set(filter_map(v => v.used && v.source != 'local' && v.source != null && !this.preload_data_packages_js.includes(v.source), false))).sort().toString());
        this.print('Data packages used: ' + data_packages_js.toString());

        if(tex_packages_not_resolved.length > 0)
        {
            console.log('DATA PACKAGES', data_packages_js, 'NOT RESOLVED', tex_packages_not_resolved);
            
            // TODO: replace by regular return? override? 
            // throw new Error('Not resolved TeX packages: ' + tex_packages_not_resolved.join(', '));
            
            //TODO: fallback on all data-packages?
            data_packages_js = this.data_package_resolver.data_packages_js;
        }
        
        this.Module = this.reload_module_if_needed(this.Module == null, this.env, this.project_dir, data_packages_js);
        
        const Module = await this.Module;
        const {FS, PATH} = Module;

        const tex_path = PATH.basename(main_tex_path), dirname = PATH.dirname(main_tex_path);

        const [xdv_path, pdf_path, log_path, aux_path] = ['.xdv', '.pdf', '.log', '.aux'].map(ext => tex_path.replace('.tex', ext));
        
        const xetex =  ['xetex' , '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--no-pdf'           , '--fmt', this.fmt.xetex , tex_path].concat((this.verbose_args[verbose] || this.verbose_args[BusytexPipeline.VerboseSilent]).xetex);
        const pdftex = ['pdftex', '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--output-format=pdf', '--fmt', this.fmt.pdftex, tex_path].concat((this.verbose_args[verbose] || this.verbose_args[BusytexPipeline.VerboseSilent]).pdftex);
        const luatex = ['luatex', '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--output-format=pdf', '--fmt', this.fmt.luatex, '--nosocket', tex_path].concat((this.verbose_args[verbose] || this.verbose_args[BusytexPipeline.VerboseSilent]).luatex);
        const bibtex8   = ['bibtex8', '--8bit', aux_path].concat((this.verbose_args[verbose] || this.verbose_args[BusytexPipeline.VerboseSilent]).bibtex8);
        const xdvipdfmx = ['xdvipdfmx', '-o', pdf_path, xdv_path].concat((this.verbose_args[verbose] || this.verbose_args[BusytexPipeline.VerboseSilent]).xdvipdfmx);

        if(FS.analyzePath(this.project_dir).object.mount.mountpoint == this.project_dir)
            FS.unmount(this.project_dir);
        FS.mount(FS.filesystems.MEMFS, {}, this.project_dir);

        let dirs = new Set(['/', this.project_dir]);

        for(const {path, contents} of files.sort((lhs, rhs) => lhs['path'] < rhs['path'] ? -1 : 1))
        {
            const absolute_path = PATH.join(this.project_dir, path);
            if(contents == null)
                this.mkdir_p(FS, PATH, absolute_path, dirs);
            else
            {
                this.mkdir_p(FS, PATH, PATH.dirname(absolute_path), dirs);
                FS.writeFile(absolute_path, contents);
            }
        }
        
        const source_dir = PATH.join(this.project_dir, dirname);
        FS.chdir(source_dir);
        
        let cmds = [];
        if(driver == 'xetex_bibtex8_dvipdfmx')
            cmds = bibtex ? [xetex, bibtex8, xetex, xetex, xdvipdfmx] : [xetex, xdvipdfmx];
        else if(driver == 'pdftex_bibtex8')
            cmds = bibtex ? [pdftex, bibtex8, pdftex, pdftex] : [pdftex];
        else if(driver == 'luatex_bibtex8')
            cmds = bibtex ? [luatex, bibtex8, luatex, luatex] : [luatex];
        
        let exit_code = 0, stdout = '', stderr = '';
        const mem_header = Uint8Array.from(Module.HEAPU8.slice(0, this.mem_header_size));
        const logs = [];
        for(const cmd of cmds)
        {
            this.remove(FS, this.texmflog);
            this.remove(FS, log_path);

            this.print('$ busytex ' + cmd.join(' '));
            ({exit_code, stdout, stderr} = Module.callMainWithRedirects(cmd, verbose != BusytexPipeline.VerboseSilent));
       

            Module.HEAPU8.fill(0);
            Module.HEAPU8.set(mem_header);
            
            this.print('$ echo $?');
            this.print(`${exit_code}\n`);

            exit_code = this.error_messages.some(err => stdout.includes(err)) ? exit_code : 0;
            logs.push({cmd : cmd.join(' '), texmflog : (verbose == BusytexPipeline.VerboseInfo || verbose == BusytexPipeline.VerboseDebug) ? read_all_text(FS, this.texmflog) : '', log : this.read_all_text(FS, log_path), stdout : stdout.trim(), stderr : stderr.trim(), exit_code : exit_code});
            
            if(exit_code != 0)
                break;
        }

        const pdf = exit_code == 0 ? this.read_all_bytes(FS, pdf_path) : null;
        const log = logs.map(({cmd, texmflog, log, exit_code, stdout, stderr}) => `$ ${cmd}\nEXITCODE: ${exit_code}\n\nTEXMFLOG:\n${texmflog}\n==\nLOG:\n${log}\n==\nSTDOUT:\n${stdout}\n==\nSTDERR:\n${stderr}\n======`).join('\n\n');
        
        // TODO: do unmount if not empty even if exceptions happened
        console.log('AFTERMOUNT', FS.analyzePath(this.project_dir));
        this.Module = this.preload == false ? null : this.Module;
        
        return {pdf : pdf, log : log, exit_code : exit_code, logs : logs};
    }
}
