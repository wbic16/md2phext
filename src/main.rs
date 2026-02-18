use clap::{Parser, Subcommand};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SCROLL_BREAK: char = '\x17';

#[derive(Parser)]
#[command(name = "phext-drop")]
#[command(about = "Drop markdown files → phext corpus for real-time reasoning")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build a phext from a directory of markdown files
    Build {
        /// Input directory (or glob of .md files)
        input: PathBuf,
        /// Output phext file (default: corpus.phext)
        #[arg(short, long, default_value = "corpus.phext")]
        output: PathBuf,
        /// Print coordinate manifest after build
        #[arg(short, long)]
        manifest: bool,
    },
    /// Dump phext as LLM-ready context with coordinate headers
    Context {
        /// Input phext file
        input: PathBuf,
        /// Max characters to emit (0 = no limit)
        #[arg(short, long, default_value = "0")]
        limit: usize,
    },
    /// Show coordinate manifest for a phext
    Map {
        /// Input phext file
        input: PathBuf,
    },
}

/// Coordinate in 9D phext space: z.z.z/y.y.y/x.x.x
/// For md→phext we use the scroll dimension (x.x.scroll) to sequence files.
/// At scale: section groups files by directory, scroll = file index within dir.
fn coord_string(scroll_idx: usize) -> String {
    // Lay files sequentially in scroll dimension; wrap at 999 into section
    let section = (scroll_idx / 999) + 1;
    let scroll = (scroll_idx % 999) + 1;
    format!("1.1.1/1.1.1/1.{}.{}", section, scroll)
}

fn collect_md_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .map(|x| x == "md")
                    .unwrap_or(false)
        })
        .map(|e| e.into_path())
        .collect();
    files.sort(); // deterministic ordering
    files
}

fn build(input: &Path, output: &Path, print_manifest: bool) {
    let files = if input.is_dir() {
        collect_md_files(input)
    } else if input.is_file() {
        vec![input.to_path_buf()]
    } else {
        eprintln!("error: {} is not a file or directory", input.display());
        std::process::exit(1);
    };

    if files.is_empty() {
        eprintln!("error: no .md files found in {}", input.display());
        std::process::exit(1);
    }

    // Scroll 0 is the manifest/index
    let mut manifest_lines = vec![
        "# phext-drop manifest".to_string(),
        format!("# source: {}", input.display()),
        format!("# files: {}", files.len()),
        "# coord → file".to_string(),
    ];

    let mut scrolls: Vec<String> = Vec::new();

    for (i, path) in files.iter().enumerate() {
        let coord = coord_string(i);
        let rel = path.strip_prefix(input).unwrap_or(path);
        manifest_lines.push(format!("{} → {}", coord, rel.display()));

        let content = fs::read_to_string(path).unwrap_or_else(|e| {
            eprintln!("warning: could not read {}: {}", path.display(), e);
            String::new()
        });

        // Embed coordinate header so LLM always knows where it is
        let scroll = format!(
            "<!-- phext:{} source:{} -->\n{}",
            coord,
            rel.display(),
            content
        );
        scrolls.push(scroll);
    }

    // Build phext: manifest scroll + content scrolls, joined by SCROLL_BREAK
    let manifest_scroll = manifest_lines.join("\n");
    let mut parts = vec![manifest_scroll];
    parts.extend(scrolls);
    let phext = parts.join(&SCROLL_BREAK.to_string());

    fs::write(output, &phext).unwrap_or_else(|e| {
        eprintln!("error writing {}: {}", output.display(), e);
        std::process::exit(1);
    });

    eprintln!(
        "✓ {} files → {} ({} bytes)",
        files.len(),
        output.display(),
        phext.len()
    );

    if print_manifest {
        println!("{}", manifest_lines.join("\n"));
    }
}

fn context(input: &Path, limit: usize) {
    let raw = fs::read_to_string(input).unwrap_or_else(|e| {
        eprintln!("error reading {}: {}", input.display(), e);
        std::process::exit(1);
    });

    // Split into scrolls, skip the manifest (scroll 0), emit with separators
    let scrolls: Vec<&str> = raw.split(SCROLL_BREAK).collect();
    let mut out = String::new();

    for scroll in scrolls.iter().skip(1) {
        if !scroll.trim().is_empty() {
            out.push_str(scroll);
            out.push_str("\n\n---\n\n");
        }
        if limit > 0 && out.len() >= limit {
            out.truncate(limit);
            break;
        }
    }

    print!("{}", out);
}

fn map_cmd(input: &Path) {
    let raw = fs::read_to_string(input).unwrap_or_else(|e| {
        eprintln!("error reading {}: {}", input.display(), e);
        std::process::exit(1);
    });

    // First scroll is the manifest
    let first = raw.split(SCROLL_BREAK).next().unwrap_or("");
    println!("{}", first);
}

fn main() {
    let cli = Cli::parse();
    match &cli.command {
        Command::Build { input, output, manifest } => build(input, output, *manifest),
        Command::Context { input, limit } => context(input, *limit),
        Command::Map { input } => map_cmd(input),
    }
}
