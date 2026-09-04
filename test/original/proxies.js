let proxies={
	filterEnumerables(object,filter)
	{
		//There will either be less or equal number of enumerables on the result
		console.assert(object&&Object.getPrototypeOf(object)===Object.prototype)
		const handler={
			ownKeys(target)
			{
				return Object.keys(target).filter(filter)
			}
		}
		return new Proxy(object,handler)
	},
	whitelistEnumerables(object,...whitelist)
	{
		//Make sure only whitelisted keys/values show up in for..of or for..in loops
		//We should make a glove version of this...
		const set=new Set(whitelist)
		return filterEnumerables(object,Set.prototype.has.bind(set))
	},
	typeAdder(object,f=(key,value)=>value)
	{
		//Use for LIAC: Meant to eventually replace the way assets in objects such as 'textures' and 'geometries' are loaded (instead of being loaded with a for loop once upon refreshing the page, this would let them be more dynamic) [[Progress postponed to code GUI instead of finishing the engine
		console.assert(object&&Object.getPrototypeOf(object)===Object.prototype)
		const handler={
			set(target,key,value)
			{
				target[key]=f(key,value)
			}
		}
		return new Proxy(object,handler)
	},
	tryGetter(object,failDefaulter=(key=>undefined),failAlerter=(key,out)=>console.error('Cannot retrieve key ',key,' from object ',object,': returning default value = ',out))
	{
		//Meant to handle what happens when we try getting an object that doesn't exist. We don't usually donjust want to return 'undefined',
		//Example:
		//	o=proxies.tryGetter({a:0},()=>"Cheese")
		//	console.log(o.q)//Error; prints "Cheese"
		//	console.log(o.a)//No error; prints 0
		console.assert(object&&Object.getPrototypeOf(object)===Object.prototype)
		const handler={
			get(target,key)
			{
				if(key in target)
					return target[key]
				const out=failDefaulter(key)
				failAlerter(key)
				return out
			}
		}
		return new Proxy(object,handler)
	},
	argumentCountChecker(object,exceptionHandler=(func,args)=>console.error('Not enough arguments on function: ',func,' Arguments: ',args))
	{
		//Meant to be used on objects containing tons of methods, such as this very file (though that would be annoying so whatever)
		//Example:
		//	let p=proxies.argumentCountChecker({a(x,y){},b(x){},c(){}})
		//	p.a()//Error
		//	p.a(1)//Error
		//	p.a(1,1)//No Error
		//	p.a(1,1,1)//No Error
		//	p.b()//Error
		//	p.b(1)//No error
		//	p.b(1,1)//No error
		//	p.b(1,1,1)//No error
		//	p.b(1,1,1,1)//No error
		//	p.b(1,1,1,1,1)//No error
		//	p.c()//No error
		//	p.c(1)//No error
		//	p.c(1,1)//No error
		console.assert(Object.getPrototypeOf(object)===Object.prototype)
		const handler={
			get(target,key)
			{
				const value=target[key]
				return !value||Object.getPrototypeOf(value)!==Function.prototype ? value : function(...args)
				{
					//Return a function that checks to make sure we're feeding in a valid number of arguments
					//(We can't auto-check to make sure they dont put in too many arguments afaik, we can only check to see if they haven't given enough)
					if(args.length<value.length)
						exceptionHandler(value, args)
					return value(...args)//We should still run the function anyway, to be consistent with the toothless nature of JS assertions...
				}
			}
		}
		return new Proxy(object,handler)
	},
	copyOnWrite(object)
	{
		//Very quickly create a shallow copy of an object
		//Not sure how useful this is though, tbh
		const copy=Object.create(object)
		const handler={
			getPrototypeOf(target) 
			{
				return Object.getPrototypeOf(object)
			}
		}
		return new Proxy(copy,handler)
	},
	flattenedInterface(object,structure)
	{
		//This is used to create easy bindings to an object.
		//Though not technically a proxy (it performs better than one, beacause defineProperty is faster than proxies), it acts like one so it belongs in proxies.js
		//Returns a list of getters and setters that read-from/write-to 'object'
		//This exists to let us not type out path names over and over again
		//Pro-tip: Structure is really nice to define when using DJSON
		//You cannot mutate structure after calling this function and expect meaningful changes (without lots of work, that would be very inefficient)
		//EXAMPLE:
		// o={a:0,b:{c:1,d:2}}
		// fi=proxies.flattenedInterface(o,{a:'A',b:{c:'C',d:'D'}})
		// JSON.stringify(fi)   --->   {A:0,C:1,D:2} //Using the flattened interface to get values in o
		// fi.A=3 //Using the flattened interface to set a value in o
		// console.log(o.a)   --->   3
		console.assert(object&&Object.getPrototypeOf(object)===Object.prototype)
		const paths=flattenedObjectTreePaths(structure)
		const out={}
		for(const path of paths)
		{
			console.assert(path.length>=2,'path.length is less than 2. It should have at least two strings in it. This shouldnt be possible with a valid structure input, given the way flattenedObjectTreePaths works with includeLeaves=true: path=',path)
			const outKey=path.pop()//Assume that the values are the keys we want to show in the flattened interface
			assert.isString(outKey,"This is an assumption about our input structure (all leaves should be strings because they're all keys of the flattened output")
			const interfacedKey=path.pop()
			assert.isString(interfacedKey,'If this fails, then either flattenedObjectTreePaths or flattenedInterface is broken (interfacedKey should be guarenteed to be a string). interfacedKey=',interfacedKey)
			const container=keyPath.get(object,path)//The thing containing interfacedKey. Explanation: X.slice(0,-1) means all but the last element of X (in python, would be X[:-1])
			Object.defineProperty(out,outKey, 
			{
				get()
				{
					return container[interfacedKey]
				},
				set(value)
				{
					container[interfacedKey]=value
				},
				enumerable:true,
			})
		}
		return out
	}
}
proxies=proxies.argumentCountChecker(proxies)