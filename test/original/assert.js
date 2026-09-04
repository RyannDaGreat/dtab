const assert=proxies.argumentCountChecker({
	rightArgumentLength(arguments)
	{
		try
		{
			const actualNumberOfArguments=arguments.length
			const minimumNumberOfArguments=arguments.callee.length
			console.assert(actualNumberOfArguments>=minimumNumberOfArguments,'Wrong number of arguments in function '+JSON.stringify(arguments.callee.name)+' (got '+actualNumberOfArguments+' but was expecting at least '+minimumNumberOfArguments+' arguments)')
		}
		catch
		{
			console.warn("Failed to use rightArgumentLength. Probably because chrome is being a beastly piece of garbage and turning on strict mode without my consent afaik.")
		}
	},
	isPrototypeOf(variable,type)
	{
		//This function REALLY NEEDS to be renamed...
		assert.rightArgumentLength(arguments)
		console.assert(variable!==undefined,'assertDefinedType: variable is undefined, and therefore does not have a prototype')
		console.assert(variable!==null     ,'assertDefinedType: variable is null, and therefore does not have a prototype'     )
		if(type!==undefined&&type!==null)
			console.assert(Object.getPrototypeOf(variable)===type.prototype, 'assertDefinedType: variable has wrong prototype')
	},
	defined(variable)
	{
		assert.rightArgumentLength(arguments)
		console.assert(variable!==undefined,'Caught undefined variable!')
	},

	isPureObject(variable)
	{
		assert.rightArgumentLength(arguments)
		assert.isPrototypeOf(variable,Object)
	},
	arePureObjects(...variables)
	{
		assert.rightArgumentLength(arguments)
		assert.isPrototypeOf(variable,Object)
		for(variable of variables)
			assert.isPureObject(variable)
	},
	isPureArray(variable)
	{
		assert.rightArgumentLength(arguments)
	},
	arePureArrays(...variables)
	{
		assert.rightArgumentLength(arguments)
		for(variable of variables)
			assert.isPureArray(variable)
	},
	isString(variable)
	{
		assert.isPrototypeOf(variable,String)
	},
	isFunction(variable)
	{
		assert.isPrototypeOf(variable,Function)
	},
	isNumber(variable)
	{
		assert.isPrototypeOf(variable,Number)
	},
})
window.assert=assert
