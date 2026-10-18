# Making a new release of jupyter_ai_persona_manager

The extension can be published to `PyPI` and `npm` manually or using the [Jupyter Releaser](https://github.com/jupyter-server/jupyter_releaser).

## Manual release

### Python package

This extension can be distributed as Python packages. All of the Python
packaging instructions are in the `pyproject.toml` file to wrap your extension in a
Python package. Before generating a package, you first need to install some tools:

```bash
pip install build twine hatch
```

Bump the version using `hatch`. By default this will create a tag.
See the docs on [hatch-nodejs-version](https://github.com/agoose77/hatch-nodejs-version#semver) for details.

```bash
hatch version <new-version>
```

Make sure to clean up all the development files before building the package:

```bash
jlpm clean:all
```

You could also clean up the local git repository:

```bash
git clean -dfX
```

To create a Python source package (`.tar.gz`) and the binary package (`.whl`) in the `dist/` directory, do:

```bash
python -m build
```

> `python setup.py sdist bdist_wheel` is deprecated and will not work for this package.

Then to upload the package to PyPI, do:

```bash
twine upload dist/*
```

### NPM package

To publish the frontend part of the extension as a NPM package, do:

```bash
npm login
npm publish --access public
```

## Automated releases with the Jupyter Releaser

The automated workflows publish distributions as GitHub release assets. They
use the repository's built-in `GITHUB_TOKEN`; no GitHub App, npm token, or PyPI
credentials are required. Enable GitHub Actions for the repository before use.
An approval may still be required by the `release` environment's protection rules.

Here is a summary of the steps to cut a new release:

- Go to the Actions panel
- Run the "Step 1: Prep Release" workflow from the default branch, setting
  `branch` to the branch containing the release code and `version_spec` to the
  exact new version. This prepares the version/changelog and draft release.
- Check the draft changelog
- Run the "Step 2: Publish Release" workflow from the default branch with the
  same target `branch` and the draft's `release_url`. It builds and validates
  the distributions, creates the version tag, uploads the distributions and
  their `asset_shas.json` checksums, and publishes the GitHub release.

The publish workflow always skips `publish-assets` (npm/PyPI publication) and
`forwardport-changelog` (creating a changelog PR on another branch). The optional
`steps_to_skip` input applies only to the populate/build phase. No package
registry publication or changelog-forwardport PR is performed by this workflow.

> [!NOTE]
> Check out the [workflow documentation](https://jupyter-releaser.readthedocs.io/en/latest/get_started/making_release_from_repo.html)
> for more information.

## Publishing to `conda-forge`

If the package is not on conda forge yet, check the documentation to learn how to add it: https://conda-forge.org/docs/maintainer/adding_pkgs.html

Otherwise a bot should pick up the new version publish to PyPI, and open a new PR on the feedstock repository automatically.
