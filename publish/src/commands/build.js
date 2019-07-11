'use strict';

const path = require('path');
const fs = require('fs');
const { gray, green, yellow, red } = require('chalk');
const { findSolFiles, flatten, compile } = require('../solidity');

const {
	COMPILED_FOLDER,
	CONTRACTS_FOLDER,
	FLATTENED_FOLDER,
	BUILD_FOLDER,
} = require('../constants');

const { stringify } = require('../util');

const DEFAULTS = {
	buildPath: path.join(__dirname, '..', '..', '..', BUILD_FOLDER),
};
const build = async ({ buildPath = DEFAULTS.buildPath, showWarnings } = {}) => {
	console.log(gray('Starting build...'));

	if (!fs.existsSync(buildPath)) {
		fs.mkdirSync(buildPath);
	}
	// Flatten all the contracts.
	// Start with the libraries, then copy our own contracts on top to ensure
	// if there's a naming clash our code wins.
	console.log(gray('Finding .sol files...'));
	const libraries = findSolFiles('node_modules');
	const contracts = findSolFiles(CONTRACTS_FOLDER);

	// The flattener isn't smart enough to handle relative links inside third-party libraries, so
	// we need to extract all paths and add them.
	// This is necessary to flatten Chainlink
	const librariesByName = Object.keys(libraries)
		// sort to ensure longer paths come first and get overwritten
		.sort((a, b) => ((a.match(/\//g) || []).length > (b.match(/\//g) || []).length ? -1 : 1))
		.reduce((memo, key) => {
			const contractPathPieces = key.split('/');
			for (let i = 1; i < contractPathPieces.length; i++) {
				memo[contractPathPieces.slice(i).join('/')] = libraries[key];
			}
			return memo;
		}, {});
	const allSolFiles = { ...libraries, ...librariesByName, ...contracts };
	console.log(
		gray(
			`Found ${Object.keys(contracts).length} sources, and ${
				Object.keys(libraries).length
			} possible libraries`
		)
	);
	console.log(gray('Flattening contracts...'));
	const sources = await flatten({ files: allSolFiles, contracts });

	const flattenedPath = path.join(buildPath, FLATTENED_FOLDER);
	Object.entries(sources).forEach(([key, { content }]) => {
		const toWrite = path.join(flattenedPath, key);
		try {
			// try make path for sub-folders (note: recursive flag only from nodejs 10.12.0)
			fs.mkdirSync(path.dirname(toWrite), { recursive: true });
		} catch (e) {}
		fs.writeFileSync(toWrite, content);
	});

	// Ok, now we need to compile all the files.
	console.log(gray('Compiling contracts...'));
	const { artifacts, errors, warnings } = compile({ sources });
	const compiledPath = path.join(buildPath, COMPILED_FOLDER);
	Object.entries(artifacts).forEach(([key, value]) => {
		const toWrite = path.join(compiledPath, key);
		try {
			// try make path for sub-folders (note: recursive flag only from nodejs 10.12.0)
			fs.mkdirSync(path.dirname(toWrite), { recursive: true });
		} catch (e) {}
		fs.writeFileSync(`${toWrite}.json`, stringify(value));
	});

	console.log(yellow(`Compiled with ${warnings.length} warnings and ${errors.length} errors`));
	if (errors.length > 0) {
		console.error(red(errors.map(({ formattedMessage }) => formattedMessage)));
		console.error();
		console.error(gray('Exiting because of compile errors.'));
		process.exit(1);
	}

	if (warnings.length && showWarnings) {
		console.log(gray(warnings.map(({ formattedMessage }) => formattedMessage).join('\n')));
	}

	// We're built!
	console.log(green('Build succeeded'));
};

module.exports = {
	build,
	cmd: program =>
		program
			.command('build')
			.description('Build (flatten and compile) solidity files')
			.option('-b, --build-path [value]', 'Build path for built files', DEFAULTS.buildPath)
			.option('-w, --show-warnings', 'Show warnings')
			.action(build),
};
