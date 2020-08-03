import type { Octokit } from "@octokit/core";
import type { Changes, Options, State } from "./types";

import { createTree } from "./create-tree";
import { createCommit } from "./create-commit";

export async function composeCreatePullRequest(
  octokit: Octokit,
  {
    owner,
    repo,
    title,
    body,
    base,
    head,
    createWhenEmpty,
    changes: changesOption,
  }: Options
) {
  const changes = Array.isArray(changesOption)
    ? changesOption
    : [changesOption];

  if (changes.length === 0)
    throw new Error(
      '[octokit-plugin-create-pull-request] "changes" cannot be an empty array'
    );

  const state: State = { octokit, owner, repo };

  // https://developer.github.com/v3/repos/#get-a-repository
  const { data: repository, headers } = await octokit.request(
    "GET /repos/:owner/:repo",
    {
      owner,
      repo,
    }
  );

  const isUser = !!headers["x-oauth-scopes"];

  if (!repository.permissions) {
    throw new Error(
      "[octokit-plugin-create-pull-request] Missing authentication"
    );
  }

  if (!base) {
    base = repository.default_branch;
  }

  state.fork = owner;

  // https://developer.github.com/v3/repos/commits/#list-commits-on-a-repository
  const {
    data: [latestCommit],
  } = await octokit.request("GET /repos/:owner/:repo/commits", {
    owner,
    repo,
    sha: base,
    per_page: 1,
  });
  state.latestCommitSha = latestCommit.sha;
  state.latestCommitTreeSha = latestCommit.commit.tree.sha;
  const baseCommitTreeSha = latestCommit.commit.tree.sha;

  for (const change of changes) {
    let treeCreated = false;
    if (change.files && Object.keys(change.files).length) {
      const latestCommitTreeSha = await createTree(
        state as Required<State>,
        change as Required<Changes>
      );

      if (latestCommitTreeSha) {
        state.latestCommitTreeSha = latestCommitTreeSha;
        treeCreated = true;
      }
    }

    if (treeCreated || change.emptyCommit !== false) {
      state.latestCommitSha = await createCommit(
        state as Required<State>,
        treeCreated,
        change
      );
    }
  }

  const hasNoChanges = baseCommitTreeSha === state.latestCommitTreeSha;
  if (hasNoChanges && createWhenEmpty === false) {
    return null;
  }

  // https://developer.github.com/v3/git/refs/#create-a-reference
  await octokit.request("POST /repos/:owner/:repo/git/refs", {
    owner: state.fork,
    repo,
    sha: state.latestCommitSha,
    ref: `refs/heads/${head}`,
  });

  // https://developer.github.com/v3/pulls/#create-a-pull-request
  return await octokit.request("POST /repos/:owner/:repo/pulls", {
    owner,
    repo,
    head: `${state.fork}:${head}`,
    base,
    title,
    body,
  });
}
