#!/usr/bin/env node

const fs = require('fs');
const neodoc = require('neodoc');
const path = require('path');
const io = require('socket.io-client');
const resolve = require('path').resolve;
const readline = require('readline-sync');

// <nodes> format: like 1#2#3#4#5#14
const args = neodoc.run(`
Usage: dlion start <nodes>
       dlion stop <nodes>
       dlion restart <nodes>
       dlion burn [-i|--ignore] <nodes> <binname>
       dlion erase <nodes>
       dlion show
       dlion [-h|--help]

Options:
    -i --ignore     Ignore burning process info.
    -h --help       Show this screen.
`, { optionsFirst: true, smartOptions: true });

// load secret token
let secret_token = null;
const dlion_dir = path.join(require('os').homedir(), '.dlion');
const token_file = path.join(dlion_dir, 'secret_token');
if(!fs.existsSync(dlion_dir)) fs.mkdirSync(dlion_dir);
if(!fs.existsSync(token_file)) {
    // create new secret token
    secret_token = readline.question("SECRET TOKEN: ");
    fs.writeFileSync(token_file, secret_token);
}
else {
    secret_token = fs.readFileSync(token_file);
}

const socket = io.connect('http://thulpwan.top:8443', { query: 'whoami='+secret_token });

const charm = require('charm')();
let progress_bar = {};
let complete_cnt = 0;
let clear_num = 0;

socket.on('reconnecting', (num) => {
    console.log('attempt number %d: reconnecting to server...', num);
});

// parse <nodes> like '3-10#13-18#19#60'
function parse_nodes(nodes) {
    function f(x) {
        range = x.split('-');
        if (range.length == 2) {
            let s1 = Number(range[0])
            let s2 = Number(range[1])
            let l = Array.from({length: s2-s1+1}, (v, k) => k+s1);
            return l;
        }
        else return parseInt(x);
    }
    return Array.prototype.concat.apply([], nodes.split('#').map(f))
}

socket.on('connect', () => {
    // if args['<nodes>'] is a single num, its type is int
    const nodes = parse_nodes(String(args['<nodes>']));

    if (args['start']) {
        socket.emit('start node', nodes);
        socket.disconnect();
    }
    else if (args['stop']) {
        socket.emit('stop node', nodes);
        socket.disconnect();
    }
    else if (args['restart']) {
        socket.emit('restart node', nodes);
        socket.disconnect();
    }
    else if (args['restartrpi']) {
        socket.emit('restart rpi', nodes);
        socket.disconnect();
    }
    else if (args['erase']) {
        socket.emit('erase node', nodes);
        socket.disconnect();
    }
    else if (args['show']) {
        socket.emit('show', (res, nodeinfo) => {
            info_str = 'NodeID\tState\t\tIP\n';
            for (let node of nodeinfo) {
                info_str += [node['nid'], node['state'], '\t'+node['ip'], '\n'].join('\t');
            }
            console.log(info_str);
            socket.disconnect();
        });
    }
    else if (args['burn']) {
        let binname = resolve(args['<binname>']);
        let bin = fs.readFileSync(binname);
        let num = nodes.length;
        complete_cnt = 0;
        clear_num = 0;

        // set charm
        charm.pipe(process.stdout);
        // set cursor invisible
        charm.cursor(false);

        // reset bars
        progress_bar = {};
        for (let node of nodes) {
            progress_bar[node] = 0;
        }
        socket.emit('burn node', nodes, binname, bin);

        // draw progress bar
        const draw = () => {
            node_cnt = 0;
            for (let node of nodes) {
                charm.write('#'+(node+' '.repeat(3)).slice(0,4));
                charm.write((' '.repeat(6)+progress_bar[node]).slice(-6)+'%    ');
                if (++node_cnt % 4 == 0) charm.write('\n');
            }
            if (node_cnt < 4) charm.write('\n');
            charm.left(100);
            clear_num = Math.floor(node_cnt/4);
            charm.up(clear_num);
        }

        if (args['-i']) {
            socket.disconnect();
        }
        else {
            let timer = setInterval(() => {
                draw();
                // All burning processes are done
                // stop timer and close websocket connection
                if (complete_cnt === num) {
                    charm.write('\n'.repeat(clear_num+1));
                    clearInterval(timer);
                    // set cusor visible
                    charm.cursor(true);
                    socket.disconnect();
                }
            }, 10);
        }
    }
});

socket.on('progress bar', (nid, data) => {
    progress_bar[nid] = data;

    // finish one node
    if (data === '100.00') complete_cnt++;
});

// clear window when burning processing is not done
process.on('SIGINT', function() {
    charm.write('\n'.repeat(clear_num+1));
    // set cusor visible
    charm.cursor(true);
    socket.disconnect();
    process.exit();
});
