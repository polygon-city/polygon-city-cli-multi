#! /usr/bin/env node

// TODO: Allow CLI options to be defined and passed through

var Promise = require('bluebird');
var async = require('async');
var program = require('commander');
var path = require('path');
var fs = Promise.promisifyAll(require('fs'));
var chalk = require('chalk');
var childProcess = require('child_process');
var shell = require('shelljs');
var turf = require('turf');

// Check for CLI binary
if (!shell.which("polygon-city")) {
  console.error(chalk.bgRed.gray('Error: Polygon City CLI not found'));
  process.exit();
}

var processFiles = function(inputDirectory, options) {
  console.log('EPSG: %j', options.epsg);
  console.log('Mapzen key: %j', options.mapzen);

  if (options.prefix) {
    console.log('Prefix: %j', options.prefix);
  }

  console.log('Output directory: %j', program.output);
  console.log('Input directory: %j', inputDirectory);

  // Check input file path is defined
  if (!inputDirectory) {
    console.error(chalk.red('Exiting: Input file path not specified'));
    process.exit(1);
  }

  // Check output file path is defined
  if (!options.output) {
    console.error(chalk.red('Exiting: Output file path not specified'));
    process.exit(1);
  }

  // Check EPSG code
  if (!options.epsg) {
    console.error(chalk.red('Exiting: EPSG code not specified'));
    process.exit(1);
  }

  // Check Mapzen key
  if (!options.mapzen) {
    console.error(chalk.red('Exiting: Mapzen Elevation key not specified'));
    process.exit(1);
  }

  fs.readdirAsync(inputDirectory).then((files) => {
    var ext, args, child;

    // Spawn a new CLI instance for each file, but only after the previous
    // one has completed
    files.forEach((file) => {
      ext = path.extname(file);
      bareName = file.split(ext)[0];

      if (ext !== '.gml') {
        return;
      }

      args = [];

      args.push('-e');
      args.push(options.epsg);
      args.push('-m');
      args.push(options.mapzen);

      if (options.prefix) {
        args.push('-p');
        args.push(options.prefix);
      }

      if (options.elevation) {
        args.push('-el');
        args.push(options.elevation);
      }

      if (options.wof) {
        args.push('-w');
        args.push(options.wof);
      }

      if (options.license) {
        args.push('-l');
        args.push(options.license);
      }

      args.push('-o');

      var output = (options.prefix) ? options.prefix + bareName : bareName;

      args.push(path.join(options.output, output));

      args.push(path.join(inputDirectory, file));

      console.log(chalk.bgGreen.gray('Spawning polygon-city process...'));
      console.log(args);

      child = childProcess.spawnSync('polygon-city', args, {
        killSignal: 'SIGINT'
      });
    });

    var outputDirs = fs.readdirSync(options.output).filter(function(file) {
      return fs.statSync(path.join(options.output, file)).isDirectory();
    });


    // Gather GeoJSON files and create a combined index that has a polygon for
    // each directory showing the area it covers

    var geojsonIndexPaths = outputDirs.map(dir => {
      var geojsonPath = path.join(options.output, dir, 'index.geojson');

      try {
        fs.statSync(geojsonPath);
        return geojsonPath;
      } catch(err) {
        return;
      }
    });

    // Remove empties
    geojsonIndexPaths = geojsonIndexPaths.filter(function(n) {
      return n !== undefined;
    });

    // console.log(geojsonIndexPaths);

    // Get GeoJSON indexes
    async.map(geojsonIndexPaths, fs.readFile, (err, results) => {
      var envelopes = [];

      if (err) {
        throw err;
      }

      var relativePath;
      results.forEach((result, index) => {
        relativePath = path.relative(options.output, geojsonIndexPaths[index]);
        envelope = turf.envelope(JSON.parse(result.toString()));

        envelope.properties.id = relativePath.split('/index.geojson')[0];
        envelope.properties.path = path.relative(options.output, geojsonIndexPaths[index]);

        envelopes.push(envelope);
      });

      var fc = turf.featurecollection(envelopes);

      fs.writeFileAsync(path.join(options.output, 'index.geojson'), JSON.stringify(fc)).then(result => {
        console.log(chalk.bgBlue.gray('All files processed. Exiting...'));
      });
    });
  }).catch((err) => {
    console.error(chalk.bgRed.gray(err));
    process.exit();
  });
};

var resumeJobs = function() {
  var child = childProcess.spawnSync('polygon-city', ['resume'], {
    killSignal: 'SIGINT'
  });
};

program
  .version('0.0.1')
  .usage('[options] <input directory>')
  .option('-e, --epsg [code]', 'EPSG code for input data')
  .option('-m, --mapzen [key]', 'Mapzen Elevation API key')
  .option('-p, --prefix [prefix]', 'Prefix for building IDs')
  .option('-el, --elevation [url]', 'Elevation endpoint')
  .option('-w, --wof [url]', 'Who\'s On First endpoint')
  .option('-l, --license [license]', 'License text')
  .option('-o, --output [directory]', 'Output directory')
  .action(processFiles);

program
  .command('resume')
  .description('Resume processing of existing jobs')
  .action(resumeJobs);

program.parse(process.argv);
