module.exports = function(grunt) {
  grunt.initConfig({
    jshint: {
      files: ['Gruntfile.js', 'tests/**/*.js', 'lib/**/*.js', '*.js']
    },
    mochaTest: {
      test: {
        options: {
          mocha: require('mocha'),
          reporter: 'spec',
          timeout: 2000
        },
        src: ['tests/*.js']
      }
    }
  });
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-mocha-test');

  grunt.registerTask('default', ['jshint', 'mochaTest']);
};
