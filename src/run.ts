import { spawn } from "./spawn";
import { fetchPR, IAPIPR } from "./api";

async function getLogLines(
  previousVersion: string
): Promise<ReadonlyArray<string>> {
  const log = await spawn("git", [
    "log",
    `...${previousVersion}`,
    "--merges",
    "--grep='Merge pull request'",
    "--format=format:%s",
    "-z",
    "--"
  ]);

  return log.split("\0");
}

interface IParsedCommit {
  readonly id: number;
  readonly remote: string;
}

function parseCommitTitle(line: string): IParsedCommit {
  // E.g.: Merge pull request #2424 from desktop/fix-shrinkwrap-file
  const re = /^Merge pull request #(\d+) from (.+)\/.*$/;
  const matches = line.match(re);
  if (!matches || matches.length !== 3) {
    throw new Error(`Unable to parse '${line}'`);
  }

  const id = parseInt(matches[1], 10);
  if (isNaN(id)) {
    throw new Error(`Unable to parse PR number from '${line}': ${matches[1]}`);
  }

  return {
    id,
    remote: matches[2]
  };
}

function capitalized(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const PlaceholderChangeType = "???";

function getChangelogEntry(prID: number, pr: IAPIPR): string {
  let issueRef = "";
  let type = PlaceholderChangeType;
  const description = capitalized(pr.title);

  const re = /Fixes #(\d+)/gi;
  let match;
  do {
    match = re.exec(pr.body);
    if (match && match.length > 1) {
      issueRef += ` #${match[1]}`;
    }
  } while (match);

  if (issueRef.length) {
    type = "Fixed";
  } else {
    issueRef = ` #${prID}`;
  }

  return `[${type}] ${description} -${issueRef}`;
}

async function getChangelogEntries(
  lines: ReadonlyArray<string>
): Promise<ReadonlyArray<string>> {
  const entries = [];
  for (const line of lines) {
    try {
      const commit = parseCommitTitle(line);
      const pr = await fetchPR(commit.id);
      if (!pr) {
        throw new Error(`Unable to get PR from API: ${commit.id}`);
      }

      const entry = getChangelogEntry(commit.id, pr);
      entries.push(entry);
    } catch (e) {
      console.warn("Unable to parse line, using the full message.", e);

      entries.push(`[${PlaceholderChangeType}] ${line}`);
    }
  }

  return entries;
}

export async function run(args: ReadonlyArray<string>): Promise<void> {
  const previousVersion = args[0];
  const lines = await getLogLines(previousVersion);
  const changelogEntries = await getChangelogEntries(lines);
  console.log(JSON.stringify(changelogEntries));
}
